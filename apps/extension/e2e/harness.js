import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { mkdtemp, mkdir, cp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(extensionDir, "../..");
const extensionFiles = JSON.parse(await readFile(path.join(extensionDir, "extension-files.json"), "utf8"));
const runtimeFiles = extensionFiles.runtime;
const recordingProbeFiles = new Map([
  [
    "recording-probe.js",
    path.join(extensionDir, "e2e/recording-probe/recording-probe.js"),
  ],
]);
const runtimeSourceDir = process.env.CHROME_BRIDGE_E2E_EXTENSION_DIR
  ? path.resolve(process.env.CHROME_BRIDGE_E2E_EXTENSION_DIR)
  : extensionDir;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function childExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once("exit", resolve));
}

export async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

export async function startServer({ port } = {}) {
  const installedPython = process.env.CHROME_BRIDGE_E2E_PYTHON;
  const command = installedPython || "uv";
  const args = installedPython
    ? ["-u", path.join(repoDir, "packages/mcp/tests/e2e_server.py")]
    : ["run", "python", "-u", "packages/mcp/tests/e2e_server.py"];
  const child = spawn(command, args, {
    cwd: repoDir,
    env: {
      ...process.env,
      ...(port === undefined ? {} : { CHROME_BRIDGE_E2E_PORT: String(port) }),
      PYTHONNOUSERSITE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const lines = createInterface({ input: child.stdout });
  let ready;
  const readiness = new Promise((resolve, reject) => {
    const onExit = (code) => reject(new Error(`E2E server exited before readiness (code ${code})`));
    child.once("exit", onExit);
    lines.on("line", (line) => {
      stdout.push(`${line}\n`);
      if (ready) return;
      try {
        const message = JSON.parse(line);
        if (message.event === "ready") {
          ready = message;
          child.off("exit", onExit);
          resolve(message);
        }
      } catch {
        // Only the readiness record is control data; all other lines are diagnostics.
      }
    });
  });
  let endpoints;
  try {
    endpoints = await withTimeout(readiness, 15_000, "E2E server readiness");
  } catch (error) {
    lines.close();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      try {
        await withTimeout(childExit(child), 3_000, "failed E2E server shutdown");
      } catch {
        child.kill("SIGKILL");
        await childExit(child);
      }
    }
    throw new Error(`${error.message}\nstdout:\n${stdout.join("")}\nstderr:\n${stderr.join("")}`, {
      cause: error,
    });
  }
  let closed = false;
  return {
    ...endpoints,
    logs: () => `stdout:\n${stdout.join("")}\nstderr:\n${stderr.join("")}`,
    async close() {
      if (closed) return;
      closed = true;
      lines.close();
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      try {
        await withTimeout(childExit(child), 3_000, "E2E server shutdown");
      } catch {
        child.kill("SIGKILL");
        await childExit(child);
      }
    },
  };
}

export async function startFixtureServer() {
  const server = createServer((request, response) => {
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    if (request.url === "/fail") {
      request.socket.destroy();
      return;
    }
    const downloadMatch = /^\/download\/(report|delayed|timeout)\.csv$/.exec(
      request.url,
    );
    if (downloadMatch) {
      const [, name] = downloadMatch;
      const delay = name === "delayed" ? 1_000 : name === "timeout" ? 500 : 0;
      setTimeout(() => {
        if (response.destroyed) return;
        const body = `name,value\n${name},42\n`;
        response.writeHead(200, {
          "content-disposition": `attachment; filename="${name}.csv"`,
          "content-length": Buffer.byteLength(body),
          "content-type": "text/csv; charset=utf-8",
        });
        response.end(body);
      }, delay);
      return;
    }
    const fixturePath = ["/slow-a", "/timeout-a"].includes(request.url)
      ? "/a"
      : request.url;
    if (fixturePath !== "/a" && fixturePath !== "/b") {
      response.writeHead(404).end("Not found");
      return;
    }
    const sendFixture = () => {
      if (response.destroyed) return;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html><head><title>Chrome Bridge E2E</title></head>
<body><main>
<h1>Isolated fixture</h1>
<p id="route-status">Route: ${fixturePath}</p>
<a id="history-link" href="${fixturePath === "/a" ? "/b" : "/a"}">History destination</a>
<button id="update">Update</button>
<a id="download" href="/download/report.csv" download>Export report</a>
<a id="download-delayed" href="/download/delayed.csv" download>Export delayed report</a>
<a id="download-timeout" href="/download/timeout.csv" download>Export timeout report</a>
<button id="hover">Hover target</button>
<button id="upload">Choose files</button>
<input id="files" type="file" multiple hidden>
<button id="upload-one">Choose one file</button>
<input id="one-file" type="file" hidden>
<label>Name <input aria-label="Name"></label>
<label>Color <select aria-label="Color"><option value="red">Red</option><option value="blue">Blue</option></select></label>
<div role="button" tabindex="0" draggable="true" id="card">Movable card</div>
<section role="region" aria-label="Drop zone" id="dropzone">Drop here</section>
<p id="drop-status">Drop: ready</p>
<p id="upload-status">Files: none</p>
<p id="upload-processing">Processing: idle</p>
<p id="hover-status">Hover: ready</p>
<p id="select-status">Selected: red</p>
<p id="key-status">Key: ready</p>
<p role="status">Ready</p>
</main>
<script>
const label = location.pathname.slice(1).toUpperCase();
document.querySelector("button").addEventListener("click", () => {
  document.querySelector("[role=status]").textContent = "Updated " + label;
});
document.querySelector("#hover").addEventListener("mouseenter", () => {
  document.querySelector("#hover-status").textContent = "Hover: completed " + label;
});
document.querySelector("select").addEventListener("change", (event) => {
  document.querySelector("#select-status").textContent = "Selected: " + event.target.value;
});
document.addEventListener("keydown", (event) => {
  document.querySelector("#key-status").textContent = "Key: " + event.key;
});
const fileInput = document.querySelector("#files");
document.querySelector("#upload").addEventListener("click", () => fileInput.click());
document.querySelector("#upload-one").addEventListener("click", () =>
  document.querySelector("#one-file").click());
fileInput.addEventListener("change", () => {
  document.querySelector("#upload-status").textContent =
    "Files: " + [...fileInput.files].map((file) => file.name).join(", ");
  const processing = document.querySelector("#upload-processing");
  processing.textContent = "Processing: pending";
  // Keep site-specific async work distinct from the post-operation DOM
  // stabilization interval, including large-file assignment in branded Chrome.
  setTimeout(() => {
    processing.textContent = "Processing: complete";
  }, 5_000);
});
const card = document.querySelector("#card");
const dropzone = document.querySelector("#dropzone");
dropzone.addEventListener("dragover", (event) => event.preventDefault());
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  document.querySelector("#drop-status").textContent = "Drop: completed " + label;
});
</script></body></html>`);
    };
    if (["/slow-a", "/timeout-a"].includes(request.url)) {
      setTimeout(sendFixture, request.url === "/timeout-a" ? 8_000 : 2_000);
    } else {
      sendFixture();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

export async function prepareExtensionArtifact(serverUrl) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "chrome-bridge-e2e-"));
  const artifactDir = path.join(rootDir, "extension");
  try {
    await mkdir(artifactDir);
    for (const relative of runtimeFiles) {
      const destination = path.join(artifactDir, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(runtimeSourceDir, relative), destination);
    }
    for (const [relative, source] of recordingProbeFiles) {
      await cp(source, path.join(artifactDir, relative));
    }
    const recordingPath = path.join(artifactDir, "recording.js");
    const recording = await readFile(recordingPath, "utf8");
    const productionFilenameResolution =
      "filename: recordingFilenameFromDownload(download),";
    if (!recording.includes(productionFilenameResolution)) {
      throw new Error("Could not locate production recording filename resolution");
    }
    // Playwright's accept-downloads mode stores extension downloads under UUID names.
    // Keep production strict and adapt only this ephemeral artifact; the conversion
    // itself has cross-platform unit coverage.
    await writeFile(
      recordingPath,
      recording.replace(
        productionFilenameResolution,
        "filename: `${DOWNLOAD_PREFIX}${requestedFilename}`,",
      ),
    );
    const backgroundPath = path.join(artifactDir, "background.js");
    const background = await readFile(backgroundPath, "utf8");
    await writeFile(
      backgroundPath,
      [
        'import { measureInputDelayProbe, measureNavigationLifecycleProbe } from "./recording-probe.js";',
        "globalThis.__chromeBridgeRecordingProbe = { measureInputDelayProbe, measureNavigationLifecycleProbe };",
        background,
      ].join("\n"),
    );
    await writeFile(
      path.join(artifactDir, "runtime-config.js"),
      `export const DEFAULT_SERVER_URL = ${JSON.stringify(serverUrl)};\n`,
    );
    const config = await readFile(path.join(artifactDir, "runtime-config.js"), "utf8");
    if (config.includes(":8765/")) throw new Error("Temporary extension artifact points to production port 8765");
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  return {
    artifactDir,
    rootDir,
    profileDir(name) {
      return path.join(rootDir, `profile-${name}`);
    },
    async close() {
      if (closed) return;
      closed = true;
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

export async function launchProfile({ artifactDir, userDataDir, name, viewport }) {
  const logs = [];
  let worker;
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: process.env.CHROME_BRIDGE_E2E_HEADED !== "1",
    viewport,
    args: [
      `--disable-extensions-except=${artifactDir}`,
      `--load-extension=${artifactDir}`,
    ],
  });
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const observePage = (page) => {
      page.on("pageerror", (error) => logs.push(`[pageerror] ${error.stack ?? error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") logs.push(`[page console] ${message.text()}`);
      });
    };
    context.pages().forEach(observePage);
    context.on("page", observePage);
    worker = context.serviceWorkers()[0] ?? await withTimeout(
      context.waitForEvent("serviceworker"),
      15_000,
      `${name} service worker`,
    );
    if (!worker.url().startsWith("chrome-extension://") || !worker.url().endsWith("/background.js")) {
      throw new Error(`Unexpected ${name} service worker URL: ${worker.url()}`);
    }
    worker.on("console", (message) => logs.push(`[worker ${message.type()}] ${message.text()}`));
  } catch (error) {
    await context.close();
    throw error;
  }
  let closed = false;
  return {
    context,
    logs,
    name,
    userDataDir,
    worker,
    async close(tracePath) {
      if (closed) return;
      closed = true;
      try {
        await context.tracing.stop(tracePath ? { path: tracePath } : undefined);
      } finally {
        await context.close();
      }
    },
  };
}

export async function connectMcp(mcpUrl) {
  const client = new Client({ name: "chrome-bridge-e2e", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  return client;
}

export async function runSdkProbe(httpUrl) {
  const installedPython = process.env.CHROME_BRIDGE_E2E_PYTHON;
  const command = installedPython || "uv";
  const script = path.join(repoDir, "packages/mcp/tests/e2e_sdk.py");
  const port = new URL(httpUrl).port;
  const args = installedPython
    ? [script, "--port", port]
    : ["run", "python", script, "--port", port];
  const child = spawn(command, args, {
    cwd: repoDir,
    env: { ...process.env, PYTHONNOUSERSITE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const code = await withTimeout(childExit(child), 20_000, "SDK E2E probe");
  if (code !== 0) {
    throw new Error(`SDK E2E probe failed (code ${code})\n${stderr.join("")}`);
  }
  return JSON.parse(stdout.join(""));
}

export function toolCaller(client, transcript) {
  return async (name, args = {}) => {
    const started = Date.now();
    const result = await client.callTool({ name, arguments: args });
    transcript.push({
      tool: name,
      browserId: args.browser_id,
      fixtureUrl: args.url?.startsWith("http://127.0.0.1:") ? args.url : undefined,
      durationMs: Date.now() - started,
      isError: result.isError === true,
    });
    if (transcript.length > 100) transcript.shift();
    return result;
  };
}

export function toolValue(result) {
  if (result.structuredContent && "result" in result.structuredContent) {
    return result.structuredContent.result;
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function toolText(result) {
  return result.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "";
}

export async function waitFor(getValue, predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await getValue();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out; last value: ${JSON.stringify(lastValue)}`);
}
