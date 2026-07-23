import { expect, test } from "@playwright/test";

import {
  observeTargetDownload,
  validateDownloadTimeout,
} from "../download.js";

function debuggerFixture() {
  const eventListeners = new Set();
  const detachListeners = new Set();
  return {
    api: {
      onEvent: {
        addListener(listener) {
          eventListeners.add(listener);
        },
        removeListener(listener) {
          eventListeners.delete(listener);
        },
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
    emit(source, method, params) {
      for (const listener of eventListeners) listener(source, method, params);
    },
    detach(source, reason) {
      for (const listener of detachListeners) listener(source, reason);
    },
    get listenerCount() {
      return eventListeners.size + detachListeners.size;
    },
  };
}

test("validates the bounded download timeout", () => {
  expect(validateDownloadTimeout(0.1)).toBe(0.1);
  expect(validateDownloadTimeout(60)).toBe(60);
  for (const value of [0, 60.1, Number.NaN, true]) {
    expect(() => validateDownloadTimeout(value)).toThrow(
      "timeout must be between 0.1 and 60 seconds",
    );
  }
});

test("observes only the exact debugger target and returns CDP metadata", async () => {
  const fixture = debuggerFixture();
  const observation = observeTargetDownload(
    { targetId: "target-a" },
    1,
    { debuggerApi: fixture.api },
  );
  observation.start();
  fixture.emit(
    { targetId: "target-b" },
    "Page.downloadWillBegin",
    { guid: "wrong", suggestedFilename: "wrong.csv" },
  );
  fixture.emit(
    { targetId: "target-a" },
    "Page.downloadWillBegin",
    { guid: "right", suggestedFilename: "report.csv" },
  );
  fixture.emit({ targetId: "target-a" }, "Page.downloadProgress", {
    guid: "right",
    state: "completed",
    receivedBytes: 42,
    totalBytes: 42,
  });
  await expect(observation.promise).resolves.toEqual({
    suggestedFilename: "report.csv",
    state: "complete",
    receivedBytes: 42,
    totalBytes: 42,
  });
  observation.cleanup();
  expect(fixture.listenerCount).toBe(0);
});

test("rejects canceled, multiple, and timed-out downloads", async () => {
  const canceledFixture = debuggerFixture();
  const canceled = observeTargetDownload(
    { targetId: "target" },
    1,
    { debuggerApi: canceledFixture.api },
  );
  canceled.start();
  canceledFixture.emit({ targetId: "target" }, "Page.downloadWillBegin", {
    guid: "one",
    suggestedFilename: "one.csv",
  });
  canceledFixture.emit({ targetId: "target" }, "Page.downloadProgress", {
    guid: "one",
    state: "canceled",
    receivedBytes: 0,
    totalBytes: 10,
  });
  await expect(canceled.promise).rejects.toThrow("canceled or interrupted");
  canceled.cleanup();

  const multipleFixture = debuggerFixture();
  const multiple = observeTargetDownload(
    { targetId: "target" },
    1,
    { debuggerApi: multipleFixture.api },
  );
  multiple.start();
  multipleFixture.emit({ targetId: "target" }, "Page.downloadWillBegin", {
    guid: "one",
    suggestedFilename: "one.csv",
  });
  multipleFixture.emit({ targetId: "target" }, "Page.downloadWillBegin", {
    guid: "two",
    suggestedFilename: "two.csv",
  });
  await expect(multiple.promise).rejects.toThrow("multiple downloads");
  multiple.cleanup();

  const timeoutFixture = debuggerFixture();
  const timeout = observeTargetDownload(
    { targetId: "target" },
    0.1,
    { debuggerApi: timeoutFixture.api },
  );
  timeout.start();
  await expect(timeout.promise).rejects.toThrow("within 0.1 seconds");
  timeout.cleanup();

  const detachedFixture = debuggerFixture();
  const detached = observeTargetDownload(
    { targetId: "target" },
    1,
    { debuggerApi: detachedFixture.api },
  );
  detached.start();
  detachedFixture.detach({ targetId: "other" }, "replaced_with_devtools");
  detachedFixture.detach({ targetId: "target" }, "replaced_with_devtools");
  await expect(detached.promise).rejects.toThrow(
    "detached while waiting for the target download",
  );
  detached.cleanup();
  expect(detachedFixture.listenerCount).toBe(0);
});
