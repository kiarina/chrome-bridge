import {
  hasValidRequestId,
  validateExtensionInitialMessage,
  validateExtensionRuntimeMessage,
  validateServerMessage,
} from "./dist/protocol.js";
import {
  loadBrowserIdentity,
  shouldReconnectForIdentityChange,
} from "./identity.js";
import { connectionActionPresentation } from "./connection-ui.js";
import { withDebuggerSession } from "./debugger-session.js";
import {
  recordTargetOperation,
  recordTargetVideo,
} from "./recording.js";
import { DEFAULT_SERVER_URL } from "./runtime-config.js";

const PROTOCOL_VERSION = 2;
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const TARGET_TAB_KEY = "targetTabId";
const OPERATING_TAB_KEY = "operatingTabId";
const OPERATING_TOKEN_KEY = "operatingToken";
const SNAPSHOT_GENERATION_KEY = "snapshotGeneration";
const LATEST_SNAPSHOT_KEY = "latestSnapshot";
const CONTENT_RUNTIME_FILE = "dist/content-runtime.js";
const NAVIGATION_TIMEOUT_MS = 10_000;
const FILE_CHOOSER_TIMEOUT_MS = 3_000;
const FILE_INPUT_CHANGE_TIMEOUT_MS = 2_000;
const MAX_WAIT_SECONDS = 10;
const MAX_SCREENSHOT_WIDTH = 1_024;
const MAX_SCREENSHOT_HEIGHT = 768;
const MAX_CONSOLE_ENTRIES = 100;
const CONSOLE_REPLAY_WAIT_MS = 100;
const ARIA_REF_PATTERN = /^s(\d+)e(\d+)$/;
const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const KEY_DEFINITIONS = {
  Alt: { key: "Alt", code: "AltLeft", keyCode: 18, location: 1 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Control: { key: "Control", code: "ControlLeft", keyCode: 17, location: 1 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  End: { key: "End", code: "End", keyCode: 35 },
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  Meta: { key: "Meta", code: "MetaLeft", keyCode: 91, location: 1 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16, location: 1 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
};

let socket;
let heartbeatTimer;
let reconnectTimer;
let reconnectAttempt = 0;
let intentionallyDisconnected = false;
let connectPromise;
let snapshotGenerationQueue = Promise.resolve();
let pageOperationQueue = Promise.resolve();

async function loadConfig() {
  const stored = await chrome.storage.local.get(["serverUrl"]);
  const { browserId, browserLabel } = await loadBrowserIdentity(
    chrome.storage.local,
  );
  return {
    serverUrl: stored.serverUrl || DEFAULT_SERVER_URL,
    browserId,
    browserLabel,
  };
}

async function setConnectionStatus(status, detail = "") {
  const action = connectionActionPresentation(status);
  await chrome.storage.local.set({
    connectionStatus: { status, detail, updatedAt: new Date().toISOString() },
  });
  await Promise.all([
    chrome.action.setIcon({ path: action.iconPath }),
    chrome.action.setTitle({ title: action.title }),
  ]);
}

async function getTargetTabId() {
  const stored = await chrome.storage.session.get(TARGET_TAB_KEY);
  const tabId = stored[TARGET_TAB_KEY];
  if (!Number.isInteger(tabId)) {
    return null;
  }
  try {
    await chrome.tabs.get(tabId);
    return tabId;
  } catch {
    await chrome.storage.session.remove([
      TARGET_TAB_KEY,
      LATEST_SNAPSHOT_KEY,
      OPERATING_TAB_KEY,
      OPERATING_TOKEN_KEY,
    ]);
    return null;
  }
}

async function setTargetTabId(tabId) {
  const previousTabId = await getTargetTabId();
  const tab = await chrome.tabs.get(requireTabId(tabId));
  await chrome.storage.session.set({ [TARGET_TAB_KEY]: tab.id });
  await clearLatestSnapshotGeneration();
  await clearContentSnapshotState(tab.id);
  if (previousTabId !== null && previousTabId !== tab.id) {
    await syncAgentUiForTab(previousTabId);
  }
  await syncAgentUiForTab(tab.id);
  return tab;
}

async function clearTargetTabIfClosed(tabId) {
  const stored = await chrome.storage.session.get(TARGET_TAB_KEY);
  if (stored[TARGET_TAB_KEY] === tabId) {
    await chrome.storage.session.remove([
      TARGET_TAB_KEY,
      LATEST_SNAPSHOT_KEY,
      OPERATING_TAB_KEY,
      OPERATING_TOKEN_KEY,
    ]);
  }
}

async function agentUiStateForTab(tabId) {
  const stored = await chrome.storage.session.get([
    TARGET_TAB_KEY,
    OPERATING_TAB_KEY,
  ]);
  if (stored[TARGET_TAB_KEY] !== tabId) return "off";
  return stored[OPERATING_TAB_KEY] === tabId ? "operating" : "target";
}

async function syncAgentUiForTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (!contentRuntimeUrl(tab) || tab.status !== "complete") return;
  try {
    await ensureContentRuntime(tabId);
    await sendContentMessage(tabId, {
      type: "chrome-bridge.ui.setState",
      state: await agentUiStateForTab(tabId),
    });
  } catch {
    // Restricted and unloading pages use the popup as their status fallback.
  }
}

async function beginOperatingTarget(tabId) {
  const token = crypto.randomUUID();
  await chrome.storage.session.set({
    [OPERATING_TAB_KEY]: tabId,
    [OPERATING_TOKEN_KEY]: token,
  });
  await syncAgentUiForTab(tabId);
  return token;
}

async function finishOperatingTarget(tabId, token) {
  const stored = await chrome.storage.session.get(OPERATING_TOKEN_KEY);
  if (stored[OPERATING_TOKEN_KEY] !== token) return;
  await chrome.storage.session.remove([
    OPERATING_TAB_KEY,
    OPERATING_TOKEN_KEY,
  ]);
  await syncAgentUiForTab(tabId);
  const currentTargetTabId = await getTargetTabId();
  if (currentTargetTabId !== null && currentTargetTabId !== tabId) {
    await syncAgentUiForTab(currentTargetTabId);
  }
}

async function recoverAgentUiState() {
  await chrome.storage.session.remove([
    OPERATING_TAB_KEY,
    OPERATING_TOKEN_KEY,
  ]);
  const targetTabId = await getTargetTabId();
  if (targetTabId !== null) await syncAgentUiForTab(targetTabId);
}

async function clearLatestSnapshotGeneration() {
  await chrome.storage.session.remove(LATEST_SNAPSHOT_KEY);
}

async function getLatestSnapshot() {
  const stored = await chrome.storage.session.get(LATEST_SNAPSHOT_KEY);
  const latest = stored[LATEST_SNAPSHOT_KEY];
  if (
    !latest ||
    !Number.isInteger(latest.tabId) ||
    !Number.isSafeInteger(latest.generation)
  ) {
    return null;
  }
  return latest;
}

async function requireCurrentAriaRef(tabId, ref) {
  if (typeof ref !== "string") {
    throw new Error("aria-ref must be a string returned by browser_snapshot");
  }
  const match = ARIA_REF_PATTERN.exec(ref);
  if (!match) {
    throw new Error(`Invalid aria-ref: ${ref}`);
  }

  const latest = await getLatestSnapshot();
  if (!latest) {
    throw new Error(
      `Stale aria-ref: ${ref}. Call browser_snapshot to get current refs.`,
    );
  }
  const generation = Number(match[1]);
  if (latest.tabId !== tabId || latest.generation !== generation) {
    throw new Error(`Stale aria-ref: ${ref}`);
  }
}

function nextSnapshotGeneration() {
  const next = snapshotGenerationQueue.then(async () => {
    const stored = await chrome.storage.session.get(SNAPSHOT_GENERATION_KEY);
    const previous = stored[SNAPSHOT_GENERATION_KEY];
    if (previous === Number.MAX_SAFE_INTEGER) {
      throw new Error("Snapshot generation space is exhausted");
    }
    const generation = Number.isSafeInteger(previous) ? previous + 1 : 1;
    await chrome.storage.session.set({ [SNAPSHOT_GENERATION_KEY]: generation });
    return generation;
  });
  snapshotGenerationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function runPageOperation(operation) {
  const next = pageOperationQueue.then(async () => {
    const tabId = await getTargetTabId();
    const token = tabId === null ? null : await beginOperatingTarget(tabId);
    try {
      return await operation();
    } finally {
      if (token !== null) await finishOperatingTarget(tabId, token);
    }
  });
  pageOperationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function getTargetTab() {
  const tabId = await getTargetTabId();
  if (tabId === null) {
    throw new Error(
      "Target tab is not selected. Call browser_tab_select with a tab ID first.",
    );
  }
  return chrome.tabs.get(tabId);
}

function contentRuntimeUrl(tab) {
  let url;
  try {
    url = new URL(tab.pendingUrl || tab.url || "");
  } catch {
    return null;
  }
  return ["http:", "https:"].includes(url.protocol) ? url : null;
}

async function waitForContentRuntimeTab(tabId) {
  const deadline = Date.now() + 10_000;
  while (true) {
    const tab = await chrome.tabs.get(tabId);
    const url = contentRuntimeUrl(tab);
    if (url && tab.status === "complete") {
      return tab;
    }
    if (!url && tab.status === "complete") {
      throw new Error(
        "Content runtime is unavailable for this target. Select an HTTP(S) tab.",
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "Content runtime is unavailable because the target did not finish loading",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function requireUnchangedTarget(tabId) {
  if ((await getTargetTabId()) !== tabId) {
    throw new Error(
      "Target tab changed while the page operation was waiting to run",
    );
  }
}

async function sendContentMessage(tabId, message) {
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response || response.ok !== true) {
    throw new Error(
      response?.error || "Content runtime returned an invalid response",
    );
  }
  return response;
}

async function clearContentSnapshotState(tabId) {
  try {
    await sendContentMessage(tabId, { type: "chrome-bridge.snapshot.clear" });
  } catch {
    // A content runtime is not guaranteed to exist until the first page operation.
  }
}

async function ensureContentRuntime(tabId) {
  try {
    await sendContentMessage(tabId, { type: "chrome-bridge.content.ping" });
    return;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [CONTENT_RUNTIME_FILE],
      });
      await sendContentMessage(tabId, { type: "chrome-bridge.content.ping" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Content runtime is unavailable for the target tab: ${detail}`,
      );
    }
  }
}

function validateSnapshotResult(result, generation) {
  if (
    !result ||
    result.generation !== generation ||
    typeof result.url !== "string" ||
    typeof result.title !== "string" ||
    typeof result.snapshot !== "string"
  ) {
    throw new Error("Content runtime returned an invalid snapshot response");
  }
  return result;
}

function validateClickPoint(result) {
  if (
    !result ||
    typeof result.x !== "number" ||
    !Number.isFinite(result.x) ||
    typeof result.y !== "number" ||
    !Number.isFinite(result.y)
  ) {
    throw new Error("Content runtime returned an invalid click point");
  }
  const settleMs = result.settleMs ?? 0;
  if (
    typeof settleMs !== "number" ||
    !Number.isFinite(settleMs) ||
    settleMs < 0 ||
    settleMs > 320
  ) {
    throw new Error("Content runtime returned an invalid cursor settle time");
  }
  return { ...result, settleMs };
}

function validateDragPoints(result) {
  if (!result || typeof result !== "object") {
    throw new Error("Content runtime returned invalid drag coordinates");
  }
  return {
    start: validateClickPoint(result.start),
    end: validateClickPoint(result.end),
  };
}

async function captureSnapshotForTarget(tabId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await waitForContentRuntimeTab(tabId);
    await requireUnchangedTarget(tabId);
    await ensureContentRuntime(tabId);
    const generation = await nextSnapshotGeneration();
    const response = await sendContentMessage(tabId, {
      type: "chrome-bridge.snapshot.generate",
      generation,
    });
    const result = validateSnapshotResult(response.result, generation);
    const currentTab = await chrome.tabs.get(tabId);
    await requireUnchangedTarget(tabId);
    if (currentTab.status === "complete" && currentTab.url === result.url) {
      await chrome.storage.session.set({
        [LATEST_SNAPSHOT_KEY]: { tabId, generation },
      });
      return result;
    }
    await clearLatestSnapshotGeneration();
  }
  throw new Error(
    "Target tab navigated while capturing its accessibility snapshot",
  );
}

async function runWithDebugger(
  tabId,
  operation,
  emulateFocus = true,
  session = undefined,
) {
  if (session) return session.run(operation, { emulateFocus });
  return withDebuggerSession(tabId, operation, { emulateFocus });
}

async function dispatchTrustedClick(debuggee, point) {
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function dispatchMouseMove(debuggee, point) {
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
}

function waitMilliseconds(durationMs) {
  if (durationMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function showCursorPress(tabId) {
  await sendContentMessage(tabId, { type: "chrome-bridge.cursor.press" });
}

function fileChooserOpened(debuggee) {
  let cleanup = () => {};
  const promise = new Promise((resolve, reject) => {
    const onEvent = (source, method, params) => {
      if (
        source.targetId !== debuggee.targetId ||
        method !== "Page.fileChooserOpened"
      ) {
        return;
      }
      if (!Number.isInteger(params?.backendNodeId)) {
        reject(new Error("The file chooser did not expose its file input"));
        return;
      }
      resolve(params);
    };
    const timeout = setTimeout(
      () => reject(new Error("The referenced element did not open a file chooser")),
      FILE_CHOOSER_TIMEOUT_MS,
    );
    chrome.debugger.onEvent.addListener(onEvent);
    cleanup = () => {
      clearTimeout(timeout);
      chrome.debugger.onEvent.removeListener(onEvent);
    };
  });
  return { promise, cleanup: () => cleanup() };
}

async function fileInputChangeBarrier(debuggee, backendNodeId) {
  const resolved = await chrome.debugger.sendCommand(debuggee, "DOM.resolveNode", {
    backendNodeId,
  });
  const inputObjectId = resolved?.object?.objectId;
  if (typeof inputObjectId !== "string" || !inputObjectId) {
    throw new Error("Chrome could not resolve the selected file input");
  }

  let promiseObjectId;
  try {
    const response = await chrome.debugger.sendCommand(
      debuggee,
      "Runtime.callFunctionOn",
      {
        objectId: inputObjectId,
        functionDeclaration: `function(timeoutMs) {
          const input = this;
          return new Promise((resolve) => {
            let settled = false;
            let timer;
            const finish = (observed) => {
              if (settled) return;
              settled = true;
              input.removeEventListener("change", onChange);
              if (timer !== undefined) clearTimeout(timer);
              resolve({ observed });
            };
            const onChange = () => finish(true);
            input.addEventListener("change", onChange, { once: true });
            timer = setTimeout(() => finish(false), timeoutMs);
          });
        }`,
        arguments: [{ value: FILE_INPUT_CHANGE_TIMEOUT_MS }],
        awaitPromise: false,
        returnByValue: false,
      },
    );
    promiseObjectId = response?.result?.objectId;
    if (typeof promiseObjectId !== "string" || !promiseObjectId) {
      throw new Error("Chrome could not observe the file input change event");
    }
  } catch (error) {
    try {
      await chrome.debugger.sendCommand(debuggee, "Runtime.releaseObject", {
        objectId: inputObjectId,
      });
    } catch {
      // Navigation can invalidate the resolved node while setting up the barrier.
    }
    throw error;
  }

  return {
    async wait() {
      const response = await chrome.debugger.sendCommand(
        debuggee,
        "Runtime.awaitPromise",
        { promiseObjectId, returnByValue: true },
      );
      return response?.result?.value?.observed === true;
    },
    async cleanup() {
      for (const objectId of [promiseObjectId, inputObjectId]) {
        try {
          await chrome.debugger.sendCommand(debuggee, "Runtime.releaseObject", {
            objectId,
          });
        } catch {
          // Navigation or debugger detach can invalidate remote objects.
        }
      }
    },
  };
}

async function dispatchTrustedDrag(debuggee, tabId, start, end) {
  await waitMilliseconds(start.settleMs);
  await dispatchMouseMove(debuggee, start);
  await sendContentMessage(tabId, {
    type: "chrome-bridge.cursor.pressed",
    pressed: true,
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });

  let current = start;
  let dragError;
  try {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const totalDurationMs = Math.round(
      Math.max(180, Math.min(500, distance * 0.75)),
    );
    const steps = Math.max(6, Math.min(12, Math.ceil(distance / 40)));
    const stepDurationMs = Math.round(totalDurationMs / steps);
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const eased = 1 - (1 - progress) ** 3;
      current = {
        x: start.x + (end.x - start.x) * eased,
        y: start.y + (end.y - start.y) * eased,
      };
      await sendContentMessage(tabId, {
        type: "chrome-bridge.drag.cursor",
        x: current.x,
        y: current.y,
        durationMs: stepDurationMs,
      });
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: current.x,
        y: current.y,
        button: "left",
        buttons: 1,
      });
      await waitMilliseconds(stepDurationMs);
    }
  } catch (error) {
    dragError = error;
  }

  let releaseError;
  try {
    await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: current.x,
      y: current.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  } catch (error) {
    releaseError = error;
  }
  try {
    await sendContentMessage(tabId, {
      type: "chrome-bridge.cursor.pressed",
      pressed: false,
    });
  } catch {
    // A drop can navigate and destroy the content runtime before cleanup.
  }
  if (dragError) throw dragError;
  if (releaseError) throw releaseError;
}

function keyDefinition(token) {
  const named = KEY_DEFINITIONS[token];
  if (named) return named;
  if ([...token].length !== 1) {
    throw new Error(`Unsupported key: ${token}`);
  }
  const character = token;
  const upper = character.toUpperCase();
  const isLetter = /^[a-z]$/i.test(character);
  const isDigit = /^\d$/.test(character);
  return {
    key: character,
    code: isLetter ? `Key${upper}` : isDigit ? `Digit${character}` : "",
    keyCode: isLetter ? upper.charCodeAt(0) : character.charCodeAt(0),
    text: character,
  };
}

async function dispatchKeyChord(debuggee, chord) {
  if (typeof chord !== "string" || chord.length === 0) {
    throw new Error("key must be a non-empty key name or character");
  }
  const tokens = chord.split("+");
  if (tokens.some((token) => !token)) {
    throw new Error(`Invalid key chord: ${chord}`);
  }

  let modifiers = 0;
  const pressed = [];
  for (const token of tokens) {
    const definition = keyDefinition(token);
    const modifierBit = MODIFIER_BITS[token] || 0;
    modifiers |= modifierBit;
    const hasNonShiftModifier = Boolean(
      modifiers &
        (MODIFIER_BITS.Alt | MODIFIER_BITS.Control | MODIFIER_BITS.Meta),
    );
    let text = modifierBit || hasNonShiftModifier ? "" : definition.text || "";
    if (modifiers & MODIFIER_BITS.Shift && /^[a-z]$/.test(text)) {
      text = text.toUpperCase();
    }
    await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      modifiers,
      windowsVirtualKeyCode: definition.keyCode,
      code: definition.code,
      key: definition.key,
      text,
      unmodifiedText: definition.text || "",
      location: definition.location || 0,
    });
    pressed.push({ definition, modifierBit });
  }

  for (const { definition, modifierBit } of pressed.reverse()) {
    modifiers &= ~modifierBit;
    await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers,
      windowsVirtualKeyCode: definition.keyCode,
      code: definition.code,
      key: definition.key,
      location: definition.location || 0,
    });
  }
}

async function dispatchText(debuggee, value) {
  if (!value) return;
  await chrome.debugger.sendCommand(debuggee, "Input.insertText", {
    text: value,
  });
}

async function waitAfterPageOperation(tabId) {
  try {
    await sendContentMessage(tabId, {
      type: "chrome-bridge.dom.waitForStable",
    });
  } catch {
    // A navigation destroys the old content runtime. The load wait below handles it.
  }
  await waitForContentRuntimeTab(tabId);
}

async function clickTarget(params, session = undefined) {
  if (typeof params.element !== "string" || !params.element.trim()) {
    throw new Error("element must be a non-empty human-readable description");
  }

  const selectedTab = await getTargetTab();
  const tab = await waitForContentRuntimeTab(selectedTab.id);
  await requireUnchangedTarget(tab.id);
  await ensureContentRuntime(tab.id);
  await requireCurrentAriaRef(tab.id, params.ref);

  await runWithDebugger(tab.id, async (debuggee) => {
    const response = await sendContentMessage(tab.id, {
      type: "chrome-bridge.click.prepare",
      ref: params.ref,
    });
    const point = validateClickPoint(response.result);
    await requireUnchangedTarget(tab.id);
    await requireCurrentAriaRef(tab.id, params.ref);
    await waitMilliseconds(point.settleMs);
    await showCursorPress(tab.id);
    await dispatchTrustedClick(debuggee, point);
  }, true, session);
  await clearLatestSnapshotGeneration();
  await waitAfterPageOperation(tab.id);
  await requireUnchangedTarget(tab.id);
  return captureSnapshotForTarget(tab.id);
}

function requireElementParams(params) {
  if (typeof params.element !== "string" || !params.element.trim()) {
    throw new Error("element must be a non-empty human-readable description");
  }
}

async function getCurrentRefTarget(params) {
  requireElementParams(params);
  const selectedTab = await getTargetTab();
  const tab = await waitForContentRuntimeTab(selectedTab.id);
  await requireUnchangedTarget(tab.id);
  await ensureContentRuntime(tab.id);
  await requireCurrentAriaRef(tab.id, params.ref);
  return tab;
}

async function finishSnapshotOperation(tabId) {
  await clearLatestSnapshotGeneration();
  await waitAfterPageOperation(tabId);
  await requireUnchangedTarget(tabId);
  return captureSnapshotForTarget(tabId);
}

async function hoverTarget(params) {
  const tab = await getCurrentRefTarget(params);
  await runWithDebugger(tab.id, async (debuggee) => {
    const response = await sendContentMessage(tab.id, {
      type: "chrome-bridge.hover.prepare",
      ref: params.ref,
    });
    const point = validateClickPoint(response.result);
    await requireUnchangedTarget(tab.id);
    await requireCurrentAriaRef(tab.id, params.ref);
    await waitMilliseconds(point.settleMs);
    await dispatchMouseMove(debuggee, point);
  });
  return finishSnapshotOperation(tab.id);
}

async function dragTarget(params) {
  for (const [name, value] of [
    ["startElement", params.startElement],
    ["endElement", params.endElement],
  ]) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${name} must be a non-empty human-readable description`);
    }
  }
  const selectedTab = await getTargetTab();
  const tab = await waitForContentRuntimeTab(selectedTab.id);
  await requireUnchangedTarget(tab.id);
  await ensureContentRuntime(tab.id);
  await requireCurrentAriaRef(tab.id, params.startRef);
  await requireCurrentAriaRef(tab.id, params.endRef);

  await runWithDebugger(tab.id, async (debuggee) => {
    const response = await sendContentMessage(tab.id, {
      type: "chrome-bridge.drag.prepare",
      startRef: params.startRef,
      endRef: params.endRef,
    });
    const points = validateDragPoints(response.result);
    await requireUnchangedTarget(tab.id);
    await requireCurrentAriaRef(tab.id, params.startRef);
    await requireCurrentAriaRef(tab.id, params.endRef);
    await dispatchTrustedDrag(debuggee, tab.id, points.start, points.end);
  });
  return finishSnapshotOperation(tab.id);
}

async function typeTarget(params) {
  const tab = await getCurrentRefTarget(params);
  if (typeof params.text !== "string") {
    throw new Error("text must be a string");
  }
  if (typeof params.submit !== "boolean") {
    throw new Error("submit must be a boolean");
  }
  await runWithDebugger(tab.id, async (debuggee) => {
    const response = await sendContentMessage(tab.id, {
      type: "chrome-bridge.type.prepare",
      ref: params.ref,
    });
    const point = validateClickPoint(response.result);
    await requireUnchangedTarget(tab.id);
    await requireCurrentAriaRef(tab.id, params.ref);
    await waitMilliseconds(point.settleMs);
    await showCursorPress(tab.id);
    await dispatchTrustedClick(debuggee, point);
    await dispatchText(debuggee, params.text);
    if (params.submit) await dispatchKeyChord(debuggee, "Enter");
  });
  return finishSnapshotOperation(tab.id);
}

async function selectOptionTarget(params) {
  const tab = await getCurrentRefTarget(params);
  if (!Array.isArray(params.values) || params.values.length === 0) {
    throw new Error("values must contain at least one option value");
  }
  if (params.values.some((value) => typeof value !== "string")) {
    throw new Error("values must contain only strings");
  }
  const preparation = await sendContentMessage(tab.id, {
    type: "chrome-bridge.select.prepare",
    ref: params.ref,
    values: params.values,
  });
  const point = validateClickPoint(preparation.result);
  const selectedValues = preparation.result?.values;
  if (
    !Array.isArray(selectedValues) ||
    selectedValues.some((value) => typeof value !== "string")
  ) {
    throw new Error("Content runtime returned invalid select values");
  }
  await waitMilliseconds(point.settleMs);
  await requireUnchangedTarget(tab.id);
  await requireCurrentAriaRef(tab.id, params.ref);
  await showCursorPress(tab.id);
  await sendContentMessage(tab.id, {
    type: "chrome-bridge.select.perform",
    ref: params.ref,
    values: selectedValues,
  });
  await requireUnchangedTarget(tab.id);
  return finishSnapshotOperation(tab.id);
}

async function uploadFilesTarget(params) {
  const tab = await getCurrentRefTarget(params);
  if (
    !Array.isArray(params.paths) ||
    params.paths.length === 0 ||
    params.paths.length > 20 ||
    params.paths.some((path) => typeof path !== "string" || !path)
  ) {
    throw new Error("paths must contain between 1 and 20 file paths");
  }

  await runWithDebugger(tab.id, async (debuggee) => {
    const response = await sendContentMessage(tab.id, {
      type: "chrome-bridge.click.prepare",
      ref: params.ref,
    });
    const point = validateClickPoint(response.result);
    await requireUnchangedTarget(tab.id);
    await requireCurrentAriaRef(tab.id, params.ref);
    await waitMilliseconds(point.settleMs);

    const chooser = fileChooserOpened(debuggee);
    let changeBarrier;
    let chooserIntercepted = false;
    try {
      await chrome.debugger.sendCommand(debuggee, "Page.enable", {
        enableFileChooserOpenedEvent: true,
      });
      await chrome.debugger.sendCommand(
        debuggee,
        "Page.setInterceptFileChooserDialog",
        { enabled: true },
      );
      chooserIntercepted = true;
      await showCursorPress(tab.id);
      await dispatchTrustedClick(debuggee, point);
      const opened = await chooser.promise;
      if (!["selectSingle", "selectMultiple"].includes(opened.mode)) {
        throw new Error("Chrome returned an unknown file chooser mode");
      }
      if (opened.mode === "selectSingle" && params.paths.length > 1) {
        throw new Error("The file input accepts only one file");
      }
      changeBarrier = await fileInputChangeBarrier(
        debuggee,
        opened.backendNodeId,
      );
      await chrome.debugger.sendCommand(debuggee, "DOM.setFileInputFiles", {
        files: params.paths,
        backendNodeId: opened.backendNodeId,
      });
      await chrome.debugger.sendCommand(
        debuggee,
        "Page.setInterceptFileChooserDialog",
        { enabled: false },
      );
      chooserIntercepted = false;
      if (!(await changeBarrier.wait())) {
        throw new Error("Chrome could not observe the file input change event");
      }
    } finally {
      chooser.cleanup();
      await changeBarrier?.cleanup();
      if (chooserIntercepted) {
        try {
          await chrome.debugger.sendCommand(
            debuggee,
            "Page.setInterceptFileChooserDialog",
            { enabled: false },
          );
        } catch {
          // Navigation or tab closure can invalidate the debugger session.
        }
      }
    }
  });
  return finishSnapshotOperation(tab.id);
}

async function pressKeyTarget(params) {
  const selectedTab = await getTargetTab();
  const tab = await waitForContentRuntimeTab(selectedTab.id);
  await requireUnchangedTarget(tab.id);
  await ensureContentRuntime(tab.id);
  await runWithDebugger(tab.id, (debuggee) =>
    dispatchKeyChord(debuggee, params.key),
  );
  await clearLatestSnapshotGeneration();
  await waitAfterPageOperation(tab.id);
  await requireUnchangedTarget(tab.id);
  return { pressed: true, key: params.key };
}

function requireHttpUrl(value) {
  if (typeof value !== "string") {
    throw new Error("url must be an HTTP(S) URL");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("url must be an HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("url must be an HTTP(S) URL");
  }
  return url.toString();
}

function topFrameNavigation(tabId) {
  let cleanup = () => {};
  const promise = new Promise((resolve, reject) => {
    const matches = (details) =>
      details.tabId === tabId && details.frameId === 0;
    const onCommitted = (details) => {
      if (matches(details)) resolve();
    };
    const onHistoryStateUpdated = (details) => {
      if (matches(details)) resolve();
    };
    const onReferenceFragmentUpdated = (details) => {
      if (matches(details)) resolve();
    };
    const onErrorOccurred = (details) => {
      if (matches(details)) {
        reject(new Error(`Target navigation failed: ${details.error}`));
      }
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        reject(new Error("Target tab closed during navigation"));
      }
    };
    const timeout = setTimeout(
      () =>
        reject(new Error("Target navigation did not start within 10 seconds")),
      NAVIGATION_TIMEOUT_MS,
    );
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.webNavigation.onHistoryStateUpdated.addListener(
      onHistoryStateUpdated,
    );
    chrome.webNavigation.onReferenceFragmentUpdated.addListener(
      onReferenceFragmentUpdated,
    );
    chrome.webNavigation.onErrorOccurred.addListener(onErrorOccurred);
    chrome.tabs.onRemoved.addListener(onRemoved);
    cleanup = () => {
      clearTimeout(timeout);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(
        onHistoryStateUpdated,
      );
      chrome.webNavigation.onReferenceFragmentUpdated.removeListener(
        onReferenceFragmentUpdated,
      );
      chrome.webNavigation.onErrorOccurred.removeListener(onErrorOccurred);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  });
  return { promise, cleanup: () => cleanup() };
}

async function navigateAndCapture(tabId, action, operationName) {
  await requireUnchangedTarget(tabId);
  await clearLatestSnapshotGeneration();
  const navigation = topFrameNavigation(tabId);
  try {
    try {
      await action();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot ${operationName} in the target tab: ${detail}`);
    }
    await navigation.promise;
  } finally {
    navigation.cleanup();
  }
  await waitForContentRuntimeTab(tabId);
  await requireUnchangedTarget(tabId);
  return captureSnapshotForTarget(tabId);
}

async function navigateTarget(params) {
  const url = requireHttpUrl(params.url);
  const tab = await getTargetTab();
  return navigateAndCapture(
    tab.id,
    async () => {
      if (tab.url === url) {
        await chrome.tabs.reload(tab.id);
      } else {
        await chrome.tabs.update(tab.id, { url });
      }
    },
    "navigate",
  );
}

async function goBackTarget() {
  const tab = await getTargetTab();
  return navigateAndCapture(
    tab.id,
    () => chrome.tabs.goBack(tab.id),
    "go back",
  );
}

async function goForwardTarget() {
  const tab = await getTargetTab();
  return navigateAndCapture(
    tab.id,
    () => chrome.tabs.goForward(tab.id),
    "go forward",
  );
}

async function waitTarget(params) {
  if (
    typeof params.time !== "number" ||
    !Number.isFinite(params.time) ||
    params.time < 0 ||
    params.time > MAX_WAIT_SECONDS
  ) {
    throw new Error(`time must be between 0 and ${MAX_WAIT_SECONDS} seconds`);
  }
  const tab = await getTargetTab();
  await requireUnchangedTarget(tab.id);
  await clearLatestSnapshotGeneration();
  await new Promise((resolve) => setTimeout(resolve, params.time * 1_000));
  await requireUnchangedTarget(tab.id);
  return { waited: true, time: params.time };
}

async function screenshotTarget() {
  const selectedTab = await getTargetTab();
  const tab = await waitForContentRuntimeTab(selectedTab.id);
  await requireUnchangedTarget(tab.id);
  await ensureContentRuntime(tab.id);
  await sendContentMessage(tab.id, {
    type: "chrome-bridge.ui.capture",
    hidden: true,
  });
  let captured;
  try {
    captured = await runWithDebugger(
      tab.id,
      async (debuggee) => {
        const metrics = await chrome.debugger.sendCommand(
          debuggee,
          "Page.getLayoutMetrics",
        );
        const viewport = metrics?.cssVisualViewport;
        const width = Math.ceil(viewport?.clientWidth || 0);
        const height = Math.ceil(viewport?.clientHeight || 0);
        if (width <= 0 || height <= 0) {
          throw new Error("Chrome returned invalid viewport metrics");
        }
        const result = await chrome.debugger.sendCommand(
          debuggee,
          "Page.captureScreenshot",
          {
            format: "png",
            fromSurface: true,
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height, scale: 1 },
          },
        );
        if (typeof result?.data !== "string" || !result.data) {
          throw new Error("Chrome returned an invalid PNG screenshot");
        }
        return result.data;
      },
      false,
    );
  } finally {
    try {
      await sendContentMessage(tab.id, {
        type: "chrome-bridge.ui.capture",
        hidden: false,
      });
    } catch {
      // Navigation or closure can destroy the content runtime after capture.
    }
  }
  const response = await sendContentMessage(tab.id, {
    type: "chrome-bridge.image.resize",
    data: captured,
    maxWidth: MAX_SCREENSHOT_WIDTH,
    maxHeight: MAX_SCREENSHOT_HEIGHT,
  });
  const resized = response.result;
  if (
    typeof resized?.data !== "string" ||
    !resized.data ||
    !Number.isInteger(resized.width) ||
    resized.width <= 0 ||
    resized.width > MAX_SCREENSHOT_WIDTH ||
    !Number.isInteger(resized.height) ||
    resized.height <= 0 ||
    resized.height > MAX_SCREENSHOT_HEIGHT
  ) {
    throw new Error("Content runtime returned an invalid resized screenshot");
  }
  await requireUnchangedTarget(tab.id);
  return { ...resized, mimeType: "image/png" };
}

function consoleArgumentText(argument) {
  if (Object.hasOwn(argument, "value")) {
    if (typeof argument.value === "string") return argument.value;
    try {
      return JSON.stringify(argument.value);
    } catch {
      return String(argument.value);
    }
  }
  if (typeof argument.unserializableValue === "string") {
    return argument.unserializableValue;
  }
  if (argument.preview) return JSON.stringify(argument.preview);
  return argument.description || JSON.stringify(argument);
}

async function consoleLogsTarget() {
  const selectedTab = await getTargetTab();
  const tab = await waitForContentRuntimeTab(selectedTab.id);
  await requireUnchangedTarget(tab.id);
  return runWithDebugger(
    tab.id,
    async (debuggee) => {
      const entries = [];
      const onEvent = (source, method, params) => {
        if (source.targetId !== debuggee.targetId) return;
        if (method === "Runtime.consoleAPICalled") {
          entries.push({
            type: params.type,
            timestamp: params.timestamp,
            message: params.args.map(consoleArgumentText).join(" "),
          });
        } else if (method === "Runtime.exceptionThrown") {
          entries.push({
            type: "exception",
            timestamp: params.timestamp,
            message:
              params.exceptionDetails?.exception?.description ||
              JSON.stringify(params.exceptionDetails),
          });
        }
        if (entries.length > MAX_CONSOLE_ENTRIES) entries.shift();
      };
      chrome.debugger.onEvent.addListener(onEvent);
      try {
        await chrome.debugger.sendCommand(debuggee, "Runtime.enable");
        await new Promise((resolve) =>
          setTimeout(resolve, CONSOLE_REPLAY_WAIT_MS),
        );
      } finally {
        try {
          await chrome.debugger.sendCommand(debuggee, "Runtime.disable");
        } catch {
          // Navigation or tab closure can invalidate the Runtime domain.
        }
        chrome.debugger.onEvent.removeListener(onEvent);
      }
      await requireUnchangedTarget(tab.id);
      return entries;
    },
    false,
  );
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      sendRuntimeMessage({ type: "ping" });
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function scheduleReconnect() {
  if (intentionallyDisconnected || reconnectTimer) {
    return;
  }
  const delay = Math.min(500 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connect();
  }, delay);
}

function connect() {
  if (connectPromise) {
    return connectPromise;
  }
  connectPromise = connectOnce().finally(() => {
    connectPromise = undefined;
  });
  return connectPromise;
}

async function connectOnce() {
  intentionallyDisconnected = false;
  const { serverUrl, browserId, browserLabel } = await loadConfig();

  if (
    socket &&
    [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)
  ) {
    return;
  }

  const url = new URL(serverUrl);
  await setConnectionStatus("connecting");
  const connectingSocket = new WebSocket(url.toString());
  socket = connectingSocket;

  connectingSocket.addEventListener("open", async () => {
    if (socket !== connectingSocket) {
      return;
    }
    reconnectAttempt = 0;
    sendInitialMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: chrome.runtime.getManifest().version,
      browserId,
      browserLabel,
    });
    startHeartbeat();
    await setConnectionStatus("connected", serverUrl);
  });

  connectingSocket.addEventListener("message", (event) => {
    if (socket !== connectingSocket) {
      return;
    }
    void handleMessage(event.data);
  });

  connectingSocket.addEventListener("close", async () => {
    if (socket !== connectingSocket) {
      return;
    }
    stopHeartbeat();
    socket = undefined;
    await setConnectionStatus("disconnected", serverUrl);
    scheduleReconnect();
  });

  connectingSocket.addEventListener("error", async () => {
    if (socket !== connectingSocket) {
      return;
    }
    await setConnectionStatus("error", `Could not connect to ${serverUrl}`);
  });
}

async function handleMessage(rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    await closeForProtocolError("Malformed server JSON");
    return;
  }
  const validationError = validateServerMessage(message);
  if (validationError) {
    if (hasValidRequestId(message)) {
      sendResponse({
        id: message.id,
        ok: false,
        error: `Invalid protocol request: ${validationError}`,
      });
    } else {
      await closeForProtocolError(validationError);
    }
    return;
  }
  if (message.type === "pong") {
    return;
  }

  const { id, type, params = {} } = message;
  if (typeof id !== "string") {
    return;
  }
  try {
    const result = await executeCommand(type, params);
    sendResponse({ id, ok: true, result });
  } catch (error) {
    sendResponse({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function sendResponse(response) {
  sendRuntimeMessage(response);
}

function sendInitialMessage(message) {
  const error = validateExtensionInitialMessage(message);
  if (error) throw new Error(error);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendRuntimeMessage(message) {
  const error = validateExtensionRuntimeMessage(message);
  if (error) throw new Error(error);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

async function closeForProtocolError(detail) {
  await setConnectionStatus("error", detail);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(1002, detail.slice(0, 123));
  }
}

async function executeCommand(type, params) {
  switch (type) {
    case "tabs.list": {
      const targetTabId = await getTargetTabId();
      return (await chrome.tabs.query({})).map((tab) =>
        summarizeTab(tab, tab.id === targetTabId),
      );
    }
    case "tabs.open": {
      const tab = await chrome.tabs.create({
        url: params.url,
        active: params.active !== false,
      });
      return summarizeTab(tab, tab.id === (await getTargetTabId()));
    }
    case "tabs.close": {
      const tab = await chrome.tabs.get(requireTabId(params.tabId));
      await chrome.tabs.remove(tab.id);
      await clearTargetTabIfClosed(tab.id);
      return { closed: true, tabId: tab.id };
    }
    case "tabs.select": {
      const tab = await setTargetTabId(params.tabId);
      return summarizeTab(tab, true);
    }
    case "tabs.activate": {
      const selectedTab = await setTargetTabId(params.tabId);
      const tab = await chrome.tabs.update(selectedTab.id, { active: true });
      if (typeof tab.windowId === "number") {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return summarizeTab(tab, true);
    }
    case "page.snapshot": {
      return runPageOperation(async () => {
        const selectedTab = await getTargetTab();
        return captureSnapshotForTarget(selectedTab.id);
      });
    }
    case "page.click": {
      return runPageOperation(async () => {
        if (params.videoFilename === undefined) return clickTarget(params);
        let selectedTab;
        try {
          selectedTab = await getTargetTab();
          await requireUnchangedTarget(selectedTab.id);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Recording did not start: ${detail}. The operation was not run.`,
          );
        }
        return recordTargetOperation({
          tabId: selectedTab.id,
          filename: params.videoFilename,
          operation: (session) => clickTarget(params, session),
        });
      });
    }
    case "page.hover": {
      return runPageOperation(() => hoverTarget(params));
    }
    case "page.type": {
      return runPageOperation(() => typeTarget(params));
    }
    case "page.selectOption": {
      return runPageOperation(() => selectOptionTarget(params));
    }
    case "page.uploadFile": {
      return runPageOperation(() => uploadFilesTarget(params));
    }
    case "page.pressKey": {
      return runPageOperation(() => pressKeyTarget(params));
    }
    case "page.navigate": {
      return runPageOperation(() => navigateTarget(params));
    }
    case "page.goBack": {
      return runPageOperation(() => goBackTarget());
    }
    case "page.goForward": {
      return runPageOperation(() => goForwardTarget());
    }
    case "page.wait": {
      return runPageOperation(async () => {
        if (params.videoFilename === undefined) return waitTarget(params);
        let selectedTab;
        try {
          selectedTab = await getTargetTab();
          await requireUnchangedTarget(selectedTab.id);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Recording did not start: ${detail}. The operation was not run.`,
          );
        }
        return recordTargetOperation({
          tabId: selectedTab.id,
          filename: params.videoFilename,
          operation: () => waitTarget(params),
        });
      });
    }
    case "page.screenshot": {
      return runPageOperation(() => screenshotTarget());
    }
    case "page.getConsoleLogs": {
      return runPageOperation(() => consoleLogsTarget());
    }
    case "page.recordVideo": {
      return runPageOperation(async () => {
        try {
          const selectedTab = await getTargetTab();
          await requireUnchangedTarget(selectedTab.id);
          return await recordTargetVideo({
            tabId: selectedTab.id,
            filename: params.filename,
            duration: params.duration,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`Recording failed: ${detail}`);
        }
      });
    }
    case "page.drag": {
      return runPageOperation(() => dragTarget(params));
    }
    default:
      throw new Error(`Unsupported command: ${type}`);
  }
}

function requireTabId(value) {
  if (!Number.isInteger(value)) {
    throw new Error("tabId must be an integer returned by browser_tabs");
  }
  return value;
}

function summarizeTab(tab, targeted = false) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    active: tab.active,
    pinned: tab.pinned,
    incognito: tab.incognito,
    title: tab.title || "",
    url: tab.url || "",
    targeted,
  };
}

async function reconnectWithNewSettings() {
  intentionallyDisconnected = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  stopHeartbeat();
  if (socket) {
    socket.close(1000, "Settings changed");
    socket = undefined;
  }
  intentionallyDisconnected = false;
  await connect();
}

chrome.runtime.onInstalled.addListener(() => void connect());
chrome.runtime.onStartup.addListener(() => void connect());
chrome.tabs.onRemoved.addListener(
  (tabId) => void clearTargetTabIfClosed(tabId),
);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "chrome-bridge.ui.getState") return false;
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    sendResponse({ ok: false, error: "Agent UI state requires a tab sender" });
    return false;
  }
  void agentUiStateForTab(tabId).then(
    (state) => sendResponse({ ok: true, state }),
    (error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
  );
  return true;
});
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  void getTargetTabId().then((targetTabId) => {
    if (details.tabId === targetTabId) {
      return clearLatestSnapshotGeneration();
    }
  });
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes.serverUrl ||
      shouldReconnectForIdentityChange(changes, areaName))
  ) {
    void reconnectWithNewSettings();
  }
});

void recoverAgentUiState();
void connect();
