import { expect, test } from "@playwright/test";

import {
  loadBrowserIdentity,
  shouldReconnectForIdentityChange,
} from "../identity.js";

const id = "123e4567-e89b-42d3-a456-426614174000";

function fakeStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async get(keys) {
      return Object.fromEntries(
        keys.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]),
      );
    },
    async set(update) {
      Object.assign(values, update);
    },
  };
}

test("creates and persists a stable default browser identity", async () => {
  const storage = fakeStorage();
  const first = await loadBrowserIdentity(storage, () => id);
  const second = await loadBrowserIdentity(storage, () => {
    throw new Error("must not regenerate a valid stored ID");
  });

  expect(first).toEqual({ browserId: id, browserLabel: "Browser 123e4567" });
  expect(second).toEqual(first);
  expect(storage.values).toEqual(first);
});

test("repairs invalid IDs and normalizes labels", async () => {
  const storage = fakeStorage({ browserId: "corrupt", browserLabel: "  Work  " });
  expect(await loadBrowserIdentity(storage, () => id)).toEqual({
    browserId: id,
    browserLabel: "Work",
  });
  storage.values.browserLabel = " ".repeat(65);
  expect(await loadBrowserIdentity(storage, () => id)).toEqual({
    browserId: id,
    browserLabel: "Browser 123e4567",
  });
});

test("reconnects for user label edits but not initial identity creation", () => {
  expect(
    shouldReconnectForIdentityChange(
      { browserLabel: { oldValue: "Work", newValue: "Personal" } },
      "local",
    ),
  ).toBe(true);
  expect(
    shouldReconnectForIdentityChange(
      { browserLabel: { newValue: "Browser 123e4567" } },
      "local",
    ),
  ).toBe(false);
});
