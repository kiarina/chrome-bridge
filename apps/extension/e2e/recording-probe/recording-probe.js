import { openDebuggerSession } from "./debugger-session.js";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function captureScreenshot(debuggee, sourceWidth, sourceHeight) {
  return chrome.debugger.sendCommand(debuggee, "Page.captureScreenshot", {
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
  });
}

export async function measureInputDelayProbe({ tabId, sampleCount = 5 }) {
  if (!Number.isInteger(tabId)) throw new Error("tabId must be an integer");
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 20) {
    throw new Error("sampleCount must be between 1 and 20");
  }
  const session = await openDebuggerSession(tabId);
  try {
    const { sourceHeight, sourceWidth } = await targetViewport(session);
    const samples = [];
    for (let index = 0; index < sampleCount; index += 1) {
      let markCaptureStarted;
      const captureStarted = new Promise((resolve) => {
        markCaptureStarted = resolve;
      });
      const captureStartedAt = performance.now();
      const capturePromise = session.tryCapture(async (debuggee) => {
        markCaptureStarted();
        return captureScreenshot(debuggee, sourceWidth, sourceHeight);
      });
      await captureStarted;
      const inputRequestedAt = performance.now();
      let inputStartedAt;
      const inputPromise = session.run(
        async (debuggee) => {
          inputStartedAt = performance.now();
          const commandStartedAt = inputStartedAt;
          await chrome.debugger.sendCommand(
            debuggee,
            "Input.dispatchMouseEvent",
            {
              type: "mouseMoved",
              x: Math.floor(sourceWidth / 2),
              y: Math.floor(sourceHeight / 2),
            },
          );
          return performance.now() - commandStartedAt;
        },
        { emulateFocus: false },
      );
      const [capture, inputCommandMs] = await Promise.all([
        capturePromise,
        inputPromise,
      ]);
      if (!capture.captured) {
        throw new Error("Input-delay probe unexpectedly skipped its capture");
      }
      samples.push({
        captureMs: inputStartedAt - captureStartedAt,
        inputCommandMs,
        inputQueueDelayMs: inputStartedAt - inputRequestedAt,
      });
      await wait(25);
    }
    const mean = (values) =>
      values.reduce((total, value) => total + value, 0) / values.length;
    const captureTimes = samples.map((sample) => sample.captureMs);
    const inputCommandTimes = samples.map((sample) => sample.inputCommandMs);
    const queueDelays = samples.map((sample) => sample.inputQueueDelayMs);
    return {
      maxCaptureMs: Math.max(...captureTimes),
      maxInputCommandMs: Math.max(...inputCommandTimes),
      maxInputQueueDelayMs: Math.max(...queueDelays),
      meanCaptureMs: mean(captureTimes),
      meanInputCommandMs: mean(inputCommandTimes),
      meanInputQueueDelayMs: mean(queueDelays),
      sampleCount,
      samples,
      sourceHeight,
      sourceWidth,
    };
  } finally {
    await session.close();
  }
}
