import { openDebuggerSession } from "./debugger-session.js";
import { fitWithinMediaBounds } from "./media-sizing.js";

const MESSAGE_TARGET = "chrome-bridge-recording-offscreen";
const OFFSCREEN_PATH = "recording-offscreen.html";
const CAPTURE_INTERVAL_MS = 100;
const OPERATION_PRE_ROLL_MS = 500;
const OPERATION_POST_ROLL_MS = 500;
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

export function settleRecordedOperation({
  operationResult,
  operationError,
  recordingResult,
  recordingError,
}) {
  if (operationError) {
    const operationDetail = errorDetail(operationError);
    if (recordingResult) {
      throw new Error(
        `${operationDetail} Recording saved: ${recordingResult.filename}`,
      );
    }
    throw new Error(
      `${operationDetail} Recording also failed: ${errorDetail(recordingError)}`,
    );
  }
  if (recordingError) {
    throw new Error(
      `Operation completed, but recording failed: ${errorDetail(recordingError)} Do not retry the operation automatically.`,
    );
  }
  return { operation: operationResult, recording: recordingResult };
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

async function createTargetRecorder({ tabId, filename }) {
  if (!Number.isInteger(tabId)) throw new Error("tabId must be an integer");
  const requestedFilename = validateRecordingFilename(filename);
  const downloadPath = recordingDownloadPath(requestedFilename);
  const id = crypto.randomUUID();
  let session;
  let offscreenReady = false;
  try {
    session = await openDebuggerSession(tabId);
    const { sourceHeight, sourceWidth } = await targetViewport(session);
    const output = fitWithinMediaBounds(sourceWidth, sourceHeight);
    await ensureOffscreenDocument();
    offscreenReady = true;
    await sendOffscreen({
      type: "start",
      id,
      width: output.width,
      height: output.height,
      frameRate: 10,
      videoBitsPerSecond: 6_000_000,
    });

    const recordingStartedAt = performance.now();
    let stopRequested = false;
    let resolveStop;
    const stopSignal = new Promise((resolve) => {
      resolveStop = resolve;
    });
    let droppedFrameCount = 0;
    let firstFrameSubmitted = false;
    let resolveFirstFrame;
    const firstFrameReady = new Promise((resolve) => {
      resolveFirstFrame = resolve;
    });
    const captureLoop = (async () => {
      let nextFrameAt = recordingStartedAt;
      while (!stopRequested) {
        const capture = await session.tryCapture((debuggee) =>
          captureFrame(debuggee, sourceWidth, sourceHeight),
        );
        if (capture.captured) {
          await sendOffscreen({ type: "frame", id, data: capture.value });
          if (!firstFrameSubmitted) {
            firstFrameSubmitted = true;
            resolveFirstFrame();
          }
        } else {
          droppedFrameCount += 1;
        }
        nextFrameAt += CAPTURE_INTERVAL_MS;
        await Promise.race([
          wait(Math.max(0, nextFrameAt - performance.now())),
          stopSignal,
        ]);
      }
    })().then(
      () => ({ error: undefined }),
      (error) => ({ error }),
    );
    const startupOutcome = await Promise.race([
      firstFrameReady.then(() => null),
      captureLoop,
    ]);
    if (startupOutcome?.error) throw startupOutcome.error;

    let finished = false;
    let encoderStopped = false;
    let objectUrl;
    let downloadId;
    async function requestCaptureStop() {
      if (stopRequested) return;
      stopRequested = true;
      resolveStop();
    }

    return {
      session,
      async captureOperationFrame(debuggee) {
        try {
          const data = await captureFrame(
            debuggee,
            sourceWidth,
            sourceHeight,
          );
          await sendOffscreen({ type: "frame", id, data });
          return true;
        } catch {
          droppedFrameCount += 1;
          return false;
        }
      },
      async finish(postRollMs = 0) {
        if (finished) throw new Error("Recording is already finalized");
        finished = true;
        if (postRollMs > 0) {
          const earlyCaptureEnd = await Promise.race([
            wait(postRollMs).then(() => null),
            captureLoop,
          ]);
          if (earlyCaptureEnd?.error) {
            await requestCaptureStop();
            throw earlyCaptureEnd.error;
          }
        }
        await requestCaptureStop();
        const captureOutcome = await captureLoop;
        if (captureOutcome.error) throw captureOutcome.error;
        const encoded = await sendOffscreen({ type: "stop", id });
        encoderStopped = true;
        const elapsedMs = Math.max(
          1,
          Math.round(performance.now() - recordingStartedAt),
        );
        objectUrl = encoded.url;
        try {
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
            throw new Error(
              "Completed download size did not match the encoded recording",
            );
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
          throw error;
        }
      },
      async close() {
        await requestCaptureStop();
        await captureLoop;
        if (!encoderStopped) {
          try {
            await sendOffscreen({ type: "abort", id });
          } catch {
            // Extension reload and offscreen failure can make abort unavailable.
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
      },
    };
  } catch (error) {
    if (offscreenReady) {
      try {
        await sendOffscreen({ type: "abort", id });
      } catch {
        // Failed startup is cleaned up best-effort.
      }
      await closeOffscreenDocument();
    }
    if (session) await session.close();
    throw error;
  }
}

export async function recordTargetVideo({ tabId, filename, duration }) {
  const durationSeconds = validateRecordingDuration(duration);
  let recorder;
  try {
    recorder = await createTargetRecorder({ tabId, filename });
    await wait(durationSeconds * 1_000);
    return await recorder.finish();
  } finally {
    if (recorder) await recorder.close();
  }
}

export async function recordTargetOperation({ tabId, filename, operation }) {
  let recorder;
  try {
    recorder = await createTargetRecorder({ tabId, filename });
  } catch (error) {
    throw new Error(
      `Recording did not start: ${errorDetail(error)}. The operation was not run.`,
    );
  }

  let operationResult;
  let operationError;
  let recordingResult;
  let recordingError;
  try {
    await wait(OPERATION_PRE_ROLL_MS);
    try {
      operationResult = await operation(
        recorder.session,
        recorder.captureOperationFrame,
      );
    } catch (error) {
      operationError = error;
    }
    try {
      recordingResult = await recorder.finish(OPERATION_POST_ROLL_MS);
    } catch (error) {
      recordingError = error;
    }
  } finally {
    await recorder.close();
  }
  return settleRecordedOperation({
    operationResult,
    operationError,
    recordingResult,
    recordingError,
  });
}
