import { expect, test } from "@playwright/test";

import {
  openDebuggerSession,
  withDebuggerSession,
} from "../debugger-session.js";

function fakeDebugger() {
  const calls = [];
  const detachListeners = new Set();
  return {
    calls,
    api: {
      async getTargets() {
        calls.push(["getTargets"]);
        return [{ id: "target-7", tabId: 7, type: "page" }];
      },
      async attach(debuggee, version) {
        calls.push(["attach", debuggee, version]);
      },
      async sendCommand(debuggee, method, params) {
        calls.push(["sendCommand", debuggee, method, params]);
      },
      async detach(debuggee) {
        calls.push(["detach", debuggee]);
      },
      onDetach: {
        addListener(listener) {
          detachListeners.add(listener);
        },
        removeListener(listener) {
          detachListeners.delete(listener);
        },
      },
    },
    externalDetach(reason = "target_closed") {
      for (const listener of detachListeners) {
        listener({ targetId: "target-7" }, reason);
      }
    },
  };
}

test("preserves attach, focus emulation, operation, and detach ordering", async () => {
  const fake = fakeDebugger();
  const result = await withDebuggerSession(
    7,
    async (debuggee) => {
      fake.calls.push(["operation", debuggee]);
      return "done";
    },
    { debuggerApi: fake.api, layoutSettleMs: 0 },
  );
  expect(result).toBe("done");
  expect(fake.calls.map((call) => call[0])).toEqual([
    "getTargets",
    "attach",
    "sendCommand",
    "operation",
    "sendCommand",
    "detach",
  ]);
  expect(fake.calls[2].slice(2)).toEqual([
    "Emulation.setFocusEmulationEnabled",
    { enabled: true },
  ]);
  expect(fake.calls[4].slice(2)).toEqual([
    "Emulation.setFocusEmulationEnabled",
    { enabled: false },
  ]);
});

test("skips capture while critical work is pending", async () => {
  const fake = fakeDebugger();
  const session = await openDebuggerSession(7, {
    debuggerApi: fake.api,
    layoutSettleMs: 0,
  });
  let release;
  const critical = session.run(
    () => new Promise((resolve) => {
      release = resolve;
    }),
    { emulateFocus: false },
  );
  await expect.poll(() => session.busy).toBe(true);
  expect(await session.tryCapture(() => "frame")).toEqual({ captured: false });
  release("ok");
  await expect(critical).resolves.toBe("ok");
  await expect(session.tryCapture(() => "frame")).resolves.toEqual({
    captured: true,
    value: "frame",
  });
  await session.close();
});

test("serializes critical operations within one session", async () => {
  const fake = fakeDebugger();
  const session = await openDebuggerSession(7, {
    debuggerApi: fake.api,
    layoutSettleMs: 0,
  });
  const order = [];
  let releaseFirst;
  const first = session.run(
    async () => {
      order.push("first-start");
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first-end");
    },
    { emulateFocus: false },
  );
  const second = session.run(
    () => {
      order.push("second");
    },
    { emulateFocus: false },
  );
  await expect.poll(() => order).toEqual(["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  expect(order).toEqual(["first-start", "first-end", "second"]);
  await session.close();
});

test("does not detach twice after an external detach", async () => {
  const fake = fakeDebugger();
  const session = await openDebuggerSession(7, { debuggerApi: fake.api });
  fake.externalDetach("replaced_with_devtools");
  await expect(session.run(() => undefined)).rejects.toThrow(
    /replaced_with_devtools/,
  );
  await session.close();
  expect(fake.calls.some((call) => call[0] === "detach")).toBe(false);
});
