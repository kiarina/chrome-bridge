import { openDebuggerSession } from "./debugger-session.js";
import { currentViewportScreenshotParams } from "./recording.js";

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

function captureScreenshot(debuggee) {
  return chrome.debugger.sendCommand(
    debuggee,
    "Page.captureScreenshot",
    currentViewportScreenshotParams({
      format: "jpeg",
      quality: 75,
    }),
  );
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
        return captureScreenshot(debuggee);
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

async function waitForTab(tabId, predicate, label) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (predicate(tab)) return tab;
    await wait(25);
  }
  throw new Error(`${label} timed out`);
}

async function navigationState(session, tabId, label) {
  const tab = await chrome.tabs.get(tabId);
  const target = (await chrome.debugger.getTargets()).find(
    (candidate) => candidate.tabId === tabId,
  );
  const frameTree = await session.run(
    (debuggee) => chrome.debugger.sendCommand(debuggee, "Page.getFrameTree"),
    { emulateFocus: false },
  );
  const frame = frameTree?.frameTree?.frame;
  if (!frame?.id || !frame?.loaderId) {
    throw new Error(`Navigation probe ${label} did not receive a top frame`);
  }
  return {
    attached: target?.attached === true,
    frameId: frame.id,
    label,
    loaderId: frame.loaderId,
    targetId: target?.id,
    url: tab.url,
  };
}

async function sampleNavigationCapture(session, action) {
  let finished = false;
  const samples = [];
  const sampling = (async () => {
    while (!finished) {
      const startedAt = performance.now();
      try {
        const capture = await session.tryCapture((debuggee) =>
          chrome.debugger.sendCommand(debuggee, "Page.captureScreenshot", {
            format: "jpeg",
            quality: 30,
            fromSurface: true,
          }),
        );
        samples.push({
          captured: capture.captured,
          durationMs: performance.now() - startedAt,
        });
      } catch (error) {
        samples.push({
          captured: false,
          durationMs: performance.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await wait(25);
    }
  })();
  try {
    await action();
  } finally {
    finished = true;
    await sampling;
  }
  return {
    failures: samples.filter((sample) => sample.error).map((sample) => sample.error),
    maxCaptureMs: Math.max(...samples.map((sample) => sample.durationMs)),
    sampleCount: samples.length,
    successes: samples.filter((sample) => sample.captured).length,
  };
}

export async function measureNavigationLifecycleProbe({ tabId, urlA, urlB }) {
  if (!Number.isInteger(tabId)) throw new Error("tabId must be an integer");
  const session = await openDebuggerSession(tabId);
  let targetId;
  const detachEvents = [];
  const onDetach = (source, reason) => {
    if (source.tabId === tabId || source.targetId === targetId) {
      detachEvents.push(reason);
    }
  };
  chrome.debugger.onDetach.addListener(onDetach);
  try {
    const initialState = await navigationState(session, tabId, "initial");
    targetId = initialState.targetId;
    const states = [initialState];
    const captures = {};
    captures.sameDocument = await sampleNavigationCapture(session, async () => {
      await session.run(
        (debuggee) => chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
          expression: 'history.pushState({}, "", "#probe")',
        }),
        { emulateFocus: false },
      );
      await waitForTab(tabId, (tab) => tab.url === `${urlA}#probe`, "same-document navigation");
    });
    states.push(await navigationState(session, tabId, "same-document"));

    captures.crossDocument = await sampleNavigationCapture(session, async () => {
      await chrome.tabs.update(tabId, { url: urlB });
      await waitForTab(
        tabId,
        (tab) => tab.url === urlB && tab.status === "complete",
        "cross-document navigation",
      );
    });
    states.push(await navigationState(session, tabId, "cross-document"));

    captures.back = await sampleNavigationCapture(session, async () => {
      await chrome.tabs.goBack(tabId);
      await waitForTab(
        tabId,
        (tab) => tab.url === `${urlA}#probe` && tab.status === "complete",
        "back navigation",
      );
    });
    states.push(await navigationState(session, tabId, "back"));

    captures.forward = await sampleNavigationCapture(session, async () => {
      await chrome.tabs.goForward(tabId);
      await waitForTab(
        tabId,
        (tab) => tab.url === urlB && tab.status === "complete",
        "forward navigation",
      );
    });
    states.push(await navigationState(session, tabId, "forward"));

    await chrome.tabs.update(tabId, { url: urlA });
    await waitForTab(
      tabId,
      (tab) => tab.url === urlA && tab.status === "complete",
      "probe reset navigation",
    );
    states.push(await navigationState(session, tabId, "reset"));
    return { captures, detachEvents, states };
  } finally {
    chrome.debugger.onDetach.removeListener(onDetach);
    await session.close();
  }
}
