import { openDebuggerSession } from "./debugger-session.js";
import { fitWithinMediaBounds } from "./media-sizing.js";

const MESSAGE_TARGET = "chrome-bridge-recording-offscreen";
const OFFSCREEN_PATH = "recording-offscreen.html";
const CAPTURE_INTERVAL_MS = 100;
const DOWNLOAD_TIMEOUT_MS = 3_000;
const DOWNLOAD_PREFIX = "chrome-bridge/";
const MIN_DURATION_SECONDS = 0.5;
const MAX_DURATION_SECONDS = 10;
const MAX_FILENAME_BYTES = 200;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error);
}

export function validateRecordingFilename(filename) {
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("filename must be a non-empty .webm basename");
  }
  if (
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(filename) ||
    !filename.endsWith(".webm")
  ) {
    throw new Error(
      "filename must be a .webm basename without path separators or control characters",
    );
  }
  if (new globalThis.TextEncoder().encode(filename).length > MAX_FILENAME_BYTES) {
    throw new Error(`filename must be at most ${MAX_FILENAME_BYTES} UTF-8 bytes`);
  }
  return filename;
}

export function validateRecordingDuration(duration) {
  if (
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration < MIN_DURATION_SECONDS ||
    duration > MAX_DURATION_SECONDS
  ) {
    throw new Error(
      `duration must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds`,
    );
  }
  return duration;
}

export function recordingDownloadPath(filename) {
  return `${DOWNLOAD_PREFIX}${validateRecordingFilename(filename)}`;
}

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["BLOBS"],
      justification: "Encode target-tab frames into a requested WebM recording",
    });
  }
  await sendOffscreen({ type: "reset" });
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

async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // The document can already be gone after extension reload or recording failure.
  }
}

async function waitForDownload(downloadId) {
  const deadline = performance.now() + DOWNLOAD_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item?.state === "complete") return item;
    if (item?.state === "interrupted") {
      throw new Error(`download was interrupted: ${item.error || "unknown error"}`);
    }
    await wait(50);
  }
  throw new Error("download did not complete within 3 seconds");
}

async function removeCommandDownload(downloadId) {
  try {
    await chrome.downloads.cancel(downloadId);
  } catch {
    // Completed and already-interrupted downloads cannot always be cancelled.
  }
  try {
    await chrome.downloads.removeFile(downloadId);
  } catch {
    // No physical file may have been created before the failure.
  }
  try {
    await chrome.downloads.erase({ id: downloadId });
  } catch {
    // Removing the history row is best-effort after deleting this command's file.
  }
}

async function targetViewport(session) {
  const metrics = await session.run(
    (debuggee) =>
      chrome.debugger.sendCommand(debuggee, "Page.getLayoutMetrics"),
    { emulateFocus: false },
  );
  const viewport = metrics?.cssVisualViewport;
  const sourceWidth = Math.ceil(viewport?.clientWidth || 0);
  const sourceHeight = Math.ceil(viewport?.clientHeight || 0);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Chrome returned invalid recording viewport metrics");
  }
  return { sourceHeight, sourceWidth };
}

async function captureFrame(debuggee, sourceWidth, sourceHeight) {
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
  if (typeof result?.data !== "string" || result.data.length === 0) {
    throw new Error("Chrome returned an invalid recording frame");
  }
  return result.data;
}

export function recordingFilenameFromDownload(download) {
  const absolute = typeof download?.filename === "string" ? download.filename : "";
  const parts = absolute.split(/[\\/]/);
  const basename = parts.at(-1);
  if (
    parts.at(-2) !== "chrome-bridge" ||
    !basename ||
    !basename.endsWith(".webm")
  ) {
    throw new Error(
      `Chrome returned an invalid completed download basename: ${JSON.stringify(basename)}`,
    );
  }
  return `${DOWNLOAD_PREFIX}${basename}`;
}

export async function recordTargetVideo({ tabId, filename, duration }) {
  if (!Number.isInteger(tabId)) throw new Error("tabId must be an integer");
  const requestedFilename = validateRecordingFilename(filename);
  const durationSeconds = validateRecordingDuration(duration);
  const downloadPath = recordingDownloadPath(requestedFilename);
  const id = crypto.randomUUID();
  const session = await openDebuggerSession(tabId);
  let downloadId;
  let objectUrl;
  let recordingStarted = false;
  let recordingStopped = false;
  try {
    const { sourceHeight, sourceWidth } = await targetViewport(session);
    const output = fitWithinMediaBounds(sourceWidth, sourceHeight);
    await ensureOffscreenDocument();
    await sendOffscreen({
      type: "start",
      id,
      width: output.width,
      height: output.height,
      frameRate: 10,
      videoBitsPerSecond: 6_000_000,
    });
    recordingStarted = true;
    const recordingStartedAt = performance.now();
    const durationMs = durationSeconds * 1_000;
    let droppedFrameCount = 0;
    let nextFrameAt = recordingStartedAt;
    while (performance.now() - recordingStartedAt < durationMs) {
      const capture = await session.tryCapture((debuggee) =>
        captureFrame(debuggee, sourceWidth, sourceHeight),
      );
      if (capture.captured) {
        await sendOffscreen({ type: "frame", id, data: capture.value });
      } else {
        droppedFrameCount += 1;
      }
      nextFrameAt += CAPTURE_INTERVAL_MS;
      await wait(Math.max(0, nextFrameAt - performance.now()));
    }
    const encoded = await sendOffscreen({ type: "stop", id });
    recordingStopped = true;
    const elapsedMs = Math.max(
      1,
      Math.round(performance.now() - recordingStartedAt),
    );
    objectUrl = encoded.url;
    downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename: downloadPath,
      conflictAction: "uniquify",
      saveAs: false,
    });
    const download = await waitForDownload(downloadId);
    if (
      !Number.isInteger(encoded.blobSize) ||
      encoded.blobSize <= 0 ||
      !Number.isInteger(encoded.frameCount) ||
      encoded.frameCount <= 0
    ) {
      throw new Error("Offscreen encoder returned invalid recording metadata");
    }
    if (
      Number.isInteger(download.fileSize) &&
      download.fileSize >= 0 &&
      download.fileSize !== encoded.blobSize
    ) {
      throw new Error("Completed download size did not match the encoded recording");
    }
    return {
      requestedFilename,
      filename: recordingFilenameFromDownload(download),
      mimeType: "video/webm",
      durationMs: elapsedMs,
      width: output.width,
      height: output.height,
      frameCount: encoded.frameCount,
      droppedFrameCount,
      sizeBytes: encoded.blobSize,
    };
  } catch (error) {
    if (downloadId !== undefined) await removeCommandDownload(downloadId);
    throw new Error(errorDetail(error));
  } finally {
    if (recordingStarted && !recordingStopped) {
      try {
        await sendOffscreen({ type: "abort", id });
      } catch {
        // Extension reload and offscreen failure can make explicit abort unavailable.
      }
    }
    if (objectUrl) {
      try {
        await sendOffscreen({ type: "revoke", id, url: objectUrl });
      } catch {
        // Closing the offscreen document also releases its object URLs.
      }
    }
    await closeOffscreenDocument();
    await session.close();
  }
}
