const PROTOCOL_VERSION = "1.3";
const EVENT_TIMEOUT_MS = 5_000;

let heldDialog;
let attachAttempt;
let monitor;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function matchesDebuggee(source, debuggee) {
  return source.targetId === debuggee.targetId;
}

async function attachToTab(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("tabId must be an integer");
  const target = (await chrome.debugger.getTargets()).find(
    (candidate) => candidate.tabId === tabId && candidate.type === "page",
  );
  if (!target) throw new Error(`No page target for tab ${tabId}`);
  const debuggee = { targetId: target.id };
  await chrome.debugger.attach(debuggee, PROTOCOL_VERSION);
  return debuggee;
}

function observeDialogs(debuggee) {
  const openings = [];
  const closings = [];
  const detaches = [];
  let resolveOpening;
  let resolveClosing;
  const opening = new Promise((resolve) => {
    resolveOpening = resolve;
  });
  const closing = new Promise((resolve) => {
    resolveClosing = resolve;
  });
  const onEvent = (source, method, params) => {
    if (!matchesDebuggee(source, debuggee)) return;
    if (method === "Page.javascriptDialogOpening") {
      openings.push(params);
      resolveOpening(params);
    } else if (method === "Page.javascriptDialogClosed") {
      closings.push(params);
      resolveClosing(params);
    }
  };
  const onDetach = (source, reason) => {
    if (matchesDebuggee(source, debuggee)) detaches.push(reason);
  };
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(onDetach);
  return {
    closing,
    closings,
    detaches,
    opening,
    openings,
    remove() {
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
    },
  };
}

function trackCommand(promise) {
  const state = { error: null, settled: false, value: null };
  const tracked = promise.then(
    (value) => {
      state.settled = true;
      state.value = value ?? null;
      return state;
    },
    (error) => {
      state.error = errorMessage(error);
      state.settled = true;
      return state;
    },
  );
  return { state, tracked };
}

async function elementCenter(debuggee, selector) {
  const result = await chrome.debugger.sendCommand(
    debuggee,
    "Runtime.evaluate",
    {
      expression: `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error("Missing probe element");
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
      returnByValue: true,
    },
  );
  const point = result?.result?.value;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new Error(`Could not resolve ${selector}`);
  }
  return point;
}

async function dispatchClick(debuggee, point) {
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    x: point.x,
    y: point.y,
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: point.x,
    y: point.y,
  });
}

async function beginHold(tabId, startCommand, label) {
  if (heldDialog) throw new Error("A dialog probe is already active");
  const debuggee = await attachToTab(tabId);
  const observer = observeDialogs(debuggee);
  try {
    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    const command = trackCommand(Promise.resolve().then(() => startCommand(debuggee)));
    const opened = await withTimeout(
      observer.opening,
      EVENT_TIMEOUT_MS,
      `${label} opening event`,
    );
    await delay(100);
    heldDialog = { command, debuggee, label, observer, tabId };
    return {
      attached: true,
      commandSettledAtReturn: command.state.settled,
      dialog: opened,
      openings: observer.openings.length,
    };
  } catch (error) {
    observer.remove();
    try {
      await chrome.debugger.detach(debuggee);
    } catch {
      // The failed command may already have detached the target.
    }
    throw error;
  }
}

async function startClickDialog({ tabId }) {
  const debuggee = await attachToTab(tabId);
  try {
    const point = await elementCenter(debuggee, "#alert-dialog");
    await chrome.debugger.detach(debuggee);
    return beginHold(tabId, (currentDebuggee) =>
      dispatchClick(currentDebuggee, point), "click dialog");
  } catch (error) {
    try {
      await chrome.debugger.detach(debuggee);
    } catch {
      // Preserve the original probe failure.
    }
    throw error;
  }
}

async function startBeforeUnload({ tabId }) {
  return beginHold(
    tabId,
    () => chrome.tabs.reload(tabId),
    "beforeunload dialog",
  );
}

async function resolveHeld({ accept, promptText }) {
  if (!heldDialog) throw new Error("No held dialog probe is active");
  const current = heldDialog;
  heldDialog = undefined;
  let handleError = null;
  try {
    const params = { accept };
    if (promptText !== undefined) params.promptText = promptText;
    try {
      await chrome.debugger.sendCommand(
        current.debuggee,
        "Page.handleJavaScriptDialog",
        params,
      );
    } catch (error) {
      handleError = errorMessage(error);
    }
    let closed = null;
    if (!handleError) {
      closed = await withTimeout(
        current.observer.closing,
        EVENT_TIMEOUT_MS,
        `${current.label} closing event`,
      );
    }
    const command = await withTimeout(
      current.command.tracked,
      EVENT_TIMEOUT_MS,
      `${current.label} command completion`,
    );
    return {
      closed,
      closings: current.observer.closings.length,
      command,
      detaches: [...current.observer.detaches],
      handleError,
    };
  } finally {
    current.observer.remove();
    try {
      await chrome.debugger.sendCommand(current.debuggee, "Page.disable");
    } catch {
      // Navigation or manual closure can invalidate the Page domain.
    }
    try {
      await chrome.debugger.detach(current.debuggee);
    } catch {
      // The target may have detached while resolving the dialog.
    }
  }
}

async function detachHeldWithoutResponse() {
  if (!heldDialog) throw new Error("No held dialog probe is active");
  const current = heldDialog;
  heldDialog = undefined;
  try {
    await chrome.debugger.detach(current.debuggee);
    await Promise.race([current.command.tracked, delay(500)]);
    return {
      closings: current.observer.closings.length,
      command: { ...current.command.state },
      detaches: [...current.observer.detaches],
    };
  } finally {
    current.observer.remove();
  }
}

async function beginAttachAttempt({
  accept = undefined,
  tabId,
  waitMs = 500,
}) {
  if (attachAttempt) throw new Error("A debugger attach attempt is already active");
  const target = (await chrome.debugger.getTargets()).find(
    (candidate) => candidate.tabId === tabId && candidate.type === "page",
  );
  if (!target) throw new Error(`No page target for tab ${tabId}`);
  const debuggee = { targetId: target.id };
  const observer = observeDialogs(debuggee);
  const attach = trackCommand(
    chrome.debugger.attach(debuggee, PROTOCOL_VERSION),
  );
  await delay(25);
  const enable = trackCommand(
    chrome.debugger.sendCommand(debuggee, "Page.enable"),
  );
  let handle;
  if (accept !== undefined) {
    handle = trackCommand(
      chrome.debugger.sendCommand(
        debuggee,
        "Page.handleJavaScriptDialog",
        { accept },
      ),
    );
  }
  attachAttempt = { attach, debuggee, enable, handle, observer };
  await delay(waitMs);
  return {
    attach: { ...attach.state },
    enable: { ...enable.state },
    handle: handle ? { ...handle.state } : null,
    openings: [...observer.openings],
  };
}

async function startMonitor({ tabId }) {
  if (monitor) throw new Error("A dialog monitor is already active");
  const debuggee = await attachToTab(tabId);
  const observer = observeDialogs(debuggee);
  try {
    await chrome.debugger.sendCommand(debuggee, "Page.enable");
  } catch (error) {
    observer.remove();
    await chrome.debugger.detach(debuggee);
    throw error;
  }
  monitor = { debuggee, observer, tabId };
  return { attached: true, tabId };
}

async function monitorState() {
  if (!monitor) throw new Error("No dialog monitor is active");
  return {
    closings: [...monitor.observer.closings],
    detaches: [...monitor.observer.detaches],
    openings: [...monitor.observer.openings],
  };
}

async function resolveMonitoredDialog({ accept, promptText }) {
  if (!monitor) throw new Error("No dialog monitor is active");
  const before = monitor.observer.closings.length;
  const params = { accept };
  if (promptText !== undefined) params.promptText = promptText;
  await chrome.debugger.sendCommand(
    monitor.debuggee,
    "Page.handleJavaScriptDialog",
    params,
  );
  const deadline = performance.now() + EVENT_TIMEOUT_MS;
  while (
    monitor.observer.closings.length === before &&
    performance.now() < deadline
  ) {
    await delay(25);
  }
  if (monitor.observer.closings.length === before) {
    throw new Error("Monitored dialog closing event timed out");
  }
  let command = null;
  if (monitor.pendingCommand) {
    command = await withTimeout(
      monitor.pendingCommand.tracked,
      EVENT_TIMEOUT_MS,
      "monitored input completion",
    );
    monitor.pendingCommand = undefined;
  }
  return { ...(await monitorState()), command };
}

async function triggerMonitoredClick({ selector }) {
  if (!monitor) throw new Error("No dialog monitor is active");
  if (monitor.pendingCommand) {
    throw new Error("A monitored input command is already pending");
  }
  const before = monitor.observer.openings.length;
  const point = await elementCenter(monitor.debuggee, selector);
  const command = trackCommand(dispatchClick(monitor.debuggee, point));
  monitor.pendingCommand = command;
  const deadline = performance.now() + EVENT_TIMEOUT_MS;
  while (
    monitor.observer.openings.length === before &&
    performance.now() < deadline
  ) {
    await delay(25);
  }
  if (monitor.observer.openings.length === before) {
    monitor.pendingCommand = undefined;
    throw new Error("Monitored click dialog opening event timed out");
  }
  await delay(100);
  return {
    command: { ...command.state },
    opening: monitor.observer.openings.at(-1),
  };
}

async function stopMonitor() {
  if (!monitor) throw new Error("No dialog monitor is active");
  const current = monitor;
  const state = {
    closings: [...current.observer.closings],
    detaches: [...current.observer.detaches],
    openings: [...current.observer.openings],
  };
  monitor = undefined;
  try {
    return state;
  } finally {
    current.observer.remove();
    try {
      await chrome.debugger.sendCommand(current.debuggee, "Page.disable");
    } catch {
      // Preserve cleanup across target lifecycle changes.
    }
    try {
      await chrome.debugger.detach(current.debuggee);
    } catch {
      // Preserve cleanup across target lifecycle changes.
    }
  }
}

async function contentMessageDuringDialog({ tabId, waitMs = 500 }) {
  const command = trackCommand(
    chrome.tabs.sendMessage(tabId, { type: "chrome-bridge.content.ping" }),
  );
  await delay(waitMs);
  return { ...command.state };
}

async function accessibilityDuringDialog({ waitMs = 500 } = {}) {
  if (!monitor) throw new Error("No dialog monitor is active");
  const command = trackCommand(
    chrome.debugger.sendCommand(
      monitor.debuggee,
      "Accessibility.getFullAXTree",
    ),
  );
  await delay(waitMs);
  if (!command.state.settled || command.state.error) {
    return { ...command.state };
  }
  const nodes = command.state.value?.nodes ?? [];
  return {
    error: null,
    names: nodes
      .map((node) => node.name?.value)
      .filter((value) => typeof value === "string" && value.length > 0),
    nodeCount: nodes.length,
    settled: true,
  };
}

export const dialogProbe = {
  accessibilityDuringDialog,
  beginAttachAttempt,
  contentMessageDuringDialog,
  detachHeldWithoutResponse,
  monitorState,
  resolveHeld,
  resolveMonitoredDialog,
  startMonitor,
  startBeforeUnload,
  startClickDialog,
  stopMonitor,
  triggerMonitoredClick,
};
