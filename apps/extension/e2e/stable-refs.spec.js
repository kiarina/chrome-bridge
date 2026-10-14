import { expect, test } from "@playwright/test";

import {
  connectMcp,
  launchProfile,
  prepareExtensionArtifact,
  reserveLoopbackPort,
  startFixtureServer,
  startServer,
  toolCaller,
  toolText,
  toolValue,
  waitFor,
} from "./harness.js";

function successful(result) {
  expect(result.isError, toolText(result)).not.toBe(true);
  return toolValue(result);
}

function refFor(snapshot, pattern) {
  const match = snapshot.snapshot.match(pattern);
  expect(match, snapshot.snapshot).not.toBeNull();
  return match[1];
}

function optionRef(snapshot, question, option) {
  return refFor(
    snapshot,
    new RegExp(`radio "Q${question} option ${option}"[^\\n]*\\[ref=([^\\]]+)\\]`),
  );
}

test("clicks land on the ref on a smoothly scrolling page", async () => {
  const port = await reserveLoopbackPort();
  const server = await startServer({ port });
  const fixture = await startFixtureServer();
  const artifact = await prepareExtensionArtifact(`ws://127.0.0.1:${port}/extension`);
  const transcript = [];
  let profile;
  let client;
  try {
    profile = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("refs"),
      name: "refs",
      viewport: { width: 1_280, height: 720 },
    });
    client = await connectMcp(server.mcpUrl);
    const call = toolCaller(client, transcript);
    await waitFor(
      async () => successful(await call("browser_instances")),
      (items) => items.length === 1,
      "browser connection",
    );
    successful(await call("browser_tab_open", { url: `${fixture.baseUrl}/form`, active: false }));
    let page = await waitFor(
      async () => successful(await call("browser_snapshot")),
      (snapshot) => snapshot.snapshot.includes("Submit answers"),
      "form snapshot",
    );
    // Each question gets a different option, so a click that lands on the
    // question below shows in the result.
    const expected = [];
    for (let q = 1; q <= 10; q++) {
      const option = ((q - 1) % 4) + 1;
      expected.push(String(option));
      page = successful(await call("browser_click", {
        element: `Q${q} option ${option}`,
        ref: optionRef(page, q, option),
      }));
    }
    page = successful(await call("browser_click", {
      element: "Submit answers",
      ref: refFor(page, /button "Submit answers"[^\n]*\[ref=([^\]]+)\]/),
    }));
    expect(page.snapshot).toContain(`Result: ${expected.join(",")}`);
  } finally {
    await client?.close().catch(() => {});
    await profile?.close().catch(() => {});
    await artifact?.close().catch(() => {});
    await fixture?.close().catch(() => {});
    await server?.close().catch(() => {});
    if (transcript.length) console.log(JSON.stringify(transcript.slice(-6)).slice(0, 4000));
  }
});

test("refs from one snapshot last until the document or the target changes", async () => {
  const port = await reserveLoopbackPort();
  const server = await startServer({ port });
  const fixture = await startFixtureServer();
  const artifact = await prepareExtensionArtifact(`ws://127.0.0.1:${port}/extension`);
  const transcript = [];
  let profile;
  let client;
  try {
    profile = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("lifetime"),
      name: "lifetime",
      viewport: { width: 1_280, height: 720 },
    });
    client = await connectMcp(server.mcpUrl);
    const call = toolCaller(client, transcript);
    await waitFor(
      async () => successful(await call("browser_instances")),
      (items) => items.length === 1,
      "browser connection",
    );
    const formTab = successful(
      await call("browser_tab_open", { url: `${fixture.baseUrl}/form`, active: false }),
    );
    const first = await waitFor(
      async () => successful(await call("browser_snapshot")),
      (snapshot) => snapshot.snapshot.includes("Submit answers"),
      "form snapshot",
    );

    // Every click uses a ref of the first snapshot, and gets the same refs back.
    const expected = [];
    let page;
    for (let q = 1; q <= 10; q++) {
      const option = ((q - 1) % 4) + 1;
      expected.push(String(option));
      page = successful(await call("browser_click", {
        element: `Q${q} option ${option}`,
        ref: optionRef(first, q, option),
      }));
      expect(optionRef(page, 10, 4)).toBe(optionRef(first, 10, 4));
    }
    // Typing, keys and waits leave them current too.
    const name = refFor(first, /textbox "Name"[^\n]*\[ref=([^\]]+)\]/);
    successful(await call("browser_type", { element: "Name", ref: name, text: "Gifu", submit: false }));
    successful(await call("browser_press_key", { key: "Tab" }));
    successful(await call("browser_wait", { time: 0.1 }));
    successful(await call("browser_wait_for", { text: "Submit answers" }));
    page = successful(await call("browser_click", {
      element: "Submit answers",
      ref: refFor(first, /button "Submit answers"[^\n]*\[ref=([^\]]+)\]/),
    }));
    expect(page.snapshot).toContain(`Result: ${expected.join(",")}`);
    expect(page.generation).toBeGreaterThan(first.generation);

    // A new document: the old refs are stale.
    successful(await call("browser_navigate", { url: `${fixture.baseUrl}/form` }));
    let stale = await call("browser_click", { element: "Q1 option 1", ref: optionRef(first, 1, 1) });
    expect(stale.isError).toBe(true);
    expect(toolText(stale)).toContain("Stale aria-ref");

    // Another target, then back: still stale.
    const fresh = successful(await call("browser_snapshot"));
    expect(optionRef(fresh, 1, 1)).not.toBe(optionRef(first, 1, 1));
    const other = successful(
      await call("browser_tab_open", { url: `${fixture.baseUrl}/a`, active: false }),
    );
    successful(await call("browser_tab_select", { tab_id: other.id }));
    successful(await call("browser_tab_select", { tab_id: formTab.id }));
    stale = await call("browser_click", { element: "Q1 option 1", ref: optionRef(fresh, 1, 1) });
    expect(stale.isError).toBe(true);
    expect(toolText(stale)).toContain("Stale aria-ref");
  } finally {
    await client?.close().catch(() => {});
    await profile?.close().catch(() => {});
    await artifact?.close().catch(() => {});
    await fixture?.close().catch(() => {});
    await server?.close().catch(() => {});
  }
});
