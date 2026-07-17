const DEFAULT_PROTOCOL_VERSION = "1.3";
const DEFAULT_LAYOUT_SETTLE_MS = 250;

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
      const value = await runExclusive("capture", operation);
      return { captured: true, value };
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
