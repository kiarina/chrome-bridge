import { expect, test } from "@playwright/test";

import {
  healthUrlForServer,
  serverIsReachable,
} from "../connection-probe.js";

test("derives a health endpoint from websocket URLs", () => {
  expect(healthUrlForServer("ws://127.0.0.1:8765/extension?old=1#hash")).toBe(
    "http://127.0.0.1:8765/health",
  );
  expect(healthUrlForServer("wss://localhost:9000/custom/path")).toBe(
    "https://localhost:9000/health",
  );
  expect(() => healthUrlForServer("https://localhost:8765/extension")).toThrow(
    "must use ws:// or wss://",
  );
});

test("probes health quietly and validates the response", async () => {
  const calls = [];
  const reachable = await serverIsReachable("ws://127.0.0.1:8765/extension", {
    fetchApi: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ status: "ok" }),
      };
    },
  });
  expect(reachable).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("http://127.0.0.1:8765/health");
  expect(calls[0].options.cache).toBe("no-store");
  expect(calls[0].options.credentials).toBe("omit");
  expect(calls[0].options.signal).toBeInstanceOf(globalThis.AbortSignal);

  for (const fetchApi of [
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ status: "wrong" }) }),
    async () => {
      throw new Error("connection refused");
    },
  ]) {
    await expect(
      serverIsReachable("ws://127.0.0.1:8765/extension", { fetchApi }),
    ).resolves.toBe(false);
  }
});

test("bounds a stalled health probe", async () => {
  const reachable = serverIsReachable("ws://127.0.0.1:8765/extension", {
    fetchApi: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    timeoutMs: 10,
  });
  await expect(reachable).resolves.toBe(false);
});
