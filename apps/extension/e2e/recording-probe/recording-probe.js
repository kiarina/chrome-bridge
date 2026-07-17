import { openDebuggerSession } from "./debugger-session.js";
import { fitWithinMediaBounds } from "./media-sizing.js";

const MESSAGE_TARGET = "chrome-bridge-recording-probe-offscreen";
const OFFSCREEN_PATH = "recording-offscreen.html";
const CAPTURE_INTERVAL_MS = 100;
const DOWNLOAD_TIMEOUT_MS = 10_000;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["BLOBS"],
    justification: "Encode isolated chrome-bridge recording probe frames",
  });
}

async function sendOffscreen(message) {
  const response = await chrome.runtime.sendMessage({
    target: MESSAGE_TARGET,
    ...message,
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Recording offscreen document failed");
  }
  return response.result;
}

async function waitForDownload(downloadId) {
  const deadline = performance.now() + DOWNLOAD_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item?.state === "complete") return item;
    if (item?.state === "interrupted") {
      throw new Error(`Recording download interrupted: ${item.error}`);
    }
    await wait(50);
  }
  throw new Error(`Recording download ${downloadId} timed out`);
}

export async function recordTargetProbe({
  tabId,
  durationMs = 1_500,
  filename = "chrome-bridge/recording-probe.webm",
}) {
  if (!Number.isInteger(tabId)) throw new Error("tabId must be an integer");
  if (!Number.isFinite(durationMs) || durationMs < 500 || durationMs > 5_000) {
    throw new Error("durationMs must be between 500 and 5000");
  }
  const id = crypto.randomUUID();
  const session = await openDebuggerSession(tabId);
  let objectUrl;
  let offscreenCreated = false;
  const captureDurations = [];
  let skippedFrames = 0;
  try {
    const metrics = await session.run(
      (debuggee) =>
        chrome.debugger.sendCommand(debuggee, "Page.getLayoutMetrics"),
      { emulateFocus: false },
    );
    const viewport = metrics?.cssVisualViewport;
    const sourceWidth = Math.ceil(viewport?.clientWidth || 0);
    const sourceHeight = Math.ceil(viewport?.clientHeight || 0);
    const output = fitWithinMediaBounds(sourceWidth, sourceHeight);
    await ensureOffscreenDocument();
    offscreenCreated = true;
    const started = await sendOffscreen({
      type: "start",
      id,
      width: output.width,
      height: output.height,
      frameRate: 10,
      videoBitsPerSecond: 6_000_000,
    });
    const recordingStartedAt = performance.now();
    let nextFrameAt = recordingStartedAt;
    while (performance.now() - recordingStartedAt < durationMs) {
      const captureStartedAt = performance.now();
      const capture = await session.tryCapture(async (debuggee) => {
        const result = await chrome.debugger.sendCommand(
          debuggee,
          "Page.captureScreenshot",
          {
            format: "jpeg",
            quality: 75,
            fromSurface: true,
            captureBeyondViewport: true,
            clip: {
              x: 0,
              y: 0,
              width: sourceWidth,
              height: sourceHeight,
              scale: 1,
            },
          },
        );
        if (typeof result?.data !== "string" || !result.data) {
          throw new Error("Chrome returned an invalid recording frame");
        }
        return result.data;
      });
      if (capture.captured) {
        captureDurations.push(performance.now() - captureStartedAt);
        await sendOffscreen({ type: "frame", id, data: capture.value });
      } else {
        skippedFrames += 1;
      }
      nextFrameAt += CAPTURE_INTERVAL_MS;
      await wait(Math.max(0, nextFrameAt - performance.now()));
    }
    const encoded = await sendOffscreen({ type: "stop", id });
    objectUrl = encoded.url;
    const downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename,
      conflictAction: "uniquify",
      saveAs: false,
    });
    const download = await waitForDownload(downloadId);
    const elapsedMs = performance.now() - recordingStartedAt;
    return {
      blobSize: encoded.blobSize,
      captureCount: captureDurations.length,
      downloadId,
      elapsedMs,
      filename: download.filename,
      frameCount: encoded.frameCount,
      height: output.height,
      maxCaptureMs: captureDurations.length
        ? Math.max(...captureDurations)
        : 0,
      meanCaptureMs: captureDurations.length
        ? captureDurations.reduce((total, value) => total + value, 0) /
          captureDurations.length
        : 0,
      mimeType: encoded.mimeType || started.mimeType,
      skippedFrames,
      sourceHeight,
      sourceWidth,
      width: output.width,
    };
  } finally {
    if (objectUrl) {
      try {
        await sendOffscreen({ type: "revoke", id, url: objectUrl });
      } catch {
        // The offscreen document may already be gone after a probe failure.
      }
    }
    if (offscreenCreated) {
      try {
        await chrome.offscreen.closeDocument();
      } catch {
        // Closing an already-closed test document is harmless.
      }
    }
    await session.close();
  }
}
