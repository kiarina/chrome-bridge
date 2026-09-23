const DEFAULT_PROTOCOL_VERSION = "1.3";
const DEFAULT_LAYOUT_SETTLE_MS = 250;
// With RenderDocument (Chromium 153), a Page.captureScreenshot that is in flight
// across a cross-document commit can stay unanswered until the target detaches.
// Frames are best effort, so an unanswered capture is dropped rather than holding
// the session's exclusive slot, and every later operation, forever.
export const DEFAULT_CAPTURE_TIMEOUT_MS = 2_000;

export class CaptureTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Chrome did not answer a screenshot capture within ${timeoutMs} ms`);
    this.name = "CaptureTimeoutError";
  }
}

export function boundCapture(capture, timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS) {
  const pending = Promise.resolve(capture);
  // An abandoned command settles only when Chrome detaches the target.
  pending.catch(() => {});
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new CaptureTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function matchesDebuggee(source, debuggee) {
  return (
    (debuggee.targetId && source.targetId === debuggee.targetId) ||
    (debuggee.tabId && source.tabId === debuggee.tabId)
  );
}

export async function openDebuggerSession(
  tabId,
  {
    debuggerApi = chrome.debugger,
    protocolVersion = DEFAULT_PROTOCOL_VERSION,
    layoutSettleMs = DEFAULT_LAYOUT_SETTLE_MS,
    captureTimeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
    wait = delay,
  } = {},
) {
  const targets = await debuggerApi.getTargets();
  const target = targets.find(
    (candidate) => candidate.tabId === tabId && candidate.type === "page",
  );
  if (!target) {
    throw new Error(`Chrome debugger target is unavailable for tab ${tabId}`);
  }
  const debuggee = { targetId: target.id };
  try {
    await debuggerApi.attach(debuggee, protocolVersion);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to operate on the target without focusing it because Chrome debugger attach failed: ${detail}`,
    );
  }

  let active;
  let closed = false;
  let detached = false;
  let detachReason = "unknown";
  let criticalPending = 0;

  const onDetach = (source, reason) => {
    if (!matchesDebuggee(source, debuggee)) return;
    detached = true;
    detachReason = reason;
  };
  debuggerApi.onDetach.addListener(onDetach);

  function requireAttached() {
    if (closed) throw new Error("Chrome debugger session is closed");
    if (detached) {
      throw new Error(`Chrome debugger session detached: ${detachReason}`);
    }
  }

  async function runExclusive(kind, operation) {
    requireAttached();
    const promise = Promise.resolve().then(() => operation(debuggee));
    const current = { kind, promise };
    active = current;
    try {
      return await promise;
    } finally {
      if (active === current) active = undefined;
    }
  }

  async function waitForActiveWork() {
    while (active) {
      try {
        await active.promise;
      } catch {
        // The pending critical operation reports its own failure to its caller.
      }
    }
  }

  return {
    debuggee,
    get detached() {
      return detached;
    },
    get busy() {
      return active !== undefined || criticalPending > 0;
    },
    async run(operation, { emulateFocus = true } = {}) {
      requireAttached();
      criticalPending += 1;
      try {
        while (active) {
          try {
            await active.promise;
          } catch {
            // The active caller receives its own operation failure.
          }
        }
      } finally {
        criticalPending -= 1;
      }
      return runExclusive("critical", async (currentDebuggee) => {
        try {
          if (emulateFocus) {
            await debuggerApi.sendCommand(
              currentDebuggee,
              "Emulation.setFocusEmulationEnabled",
              { enabled: true },
            );
            await wait(layoutSettleMs);
          }
          return await operation(currentDebuggee);
        } finally {
          if (emulateFocus && !detached) {
            try {
              await debuggerApi.sendCommand(
                currentDebuggee,
                "Emulation.setFocusEmulationEnabled",
                { enabled: false },
              );
            } catch {
              // Navigation or tab closure can invalidate focus emulation first.
            }
          }
        }
      });
    },
    async tryCapture(operation) {
      if (closed || detached || active || criticalPending > 0) {
        return { captured: false };
      }
      try {
        const value = await runExclusive("capture", (currentDebuggee) =>
          boundCapture(operation(currentDebuggee), captureTimeoutMs),
        );
        return { captured: true, value };
      } catch (error) {
        if (error instanceof CaptureTimeoutError) {
          return { captured: false, timedOut: true };
        }
        throw error;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await waitForActiveWork();
      debuggerApi.onDetach.removeListener(onDetach);
      if (detached) return;
      try {
        await debuggerApi.detach(debuggee);
      } catch {
        // Tab closure and navigation can detach before best-effort cleanup.
      }
    },
  };
}

export async function withDebuggerSession(
  tabId,
  operation,
  { emulateFocus = true, ...options } = {},
) {
  const session = await openDebuggerSession(tabId, options);
  try {
    return await session.run(operation, { emulateFocus });
  } finally {
    await session.close();
  }
}
