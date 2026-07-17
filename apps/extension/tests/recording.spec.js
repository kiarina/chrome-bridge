import { expect, test } from "@playwright/test";

import {
  OperationOutcomeUnknownError,
  recordingDownloadPath,
  recordingFilenameFromDownload,
  settleRecordedOperation,
  validateRecordingDuration,
  validateRecordingFilename,
} from "../recording.js";

test("accepts a bounded WebM basename and builds the fixed download path", () => {
  expect(validateRecordingFilename("操作記録.webm")).toBe("操作記録.webm");
  expect(recordingDownloadPath("checkout (1).webm")).toBe(
    "chrome-bridge/checkout (1).webm",
  );
  expect(validateRecordingDuration(0.5)).toBe(0.5);
  expect(validateRecordingDuration(10)).toBe(10);
});

test("settles recorded operation success without changing its operation value", () => {
  const recording = { filename: "chrome-bridge/wait.webm" };
  expect(
    settleRecordedOperation({
      operationResult: { waited: true, time: 1 },
      recordingResult: recording,
    }),
  ).toEqual({
    operation: { waited: true, time: 1 },
    recording,
  });
});

test("keeps operation outcome primary across mixed recording failures", () => {
  expect(() =>
    settleRecordedOperation({
      operationResult: { waited: true },
      recordingError: new Error("download interrupted"),
    }),
  ).toThrow(
    "Operation completed, but recording failed: download interrupted Do not retry the operation automatically.",
  );
  expect(() =>
    settleRecordedOperation({
      operationError: new Error("wait failed"),
      recordingResult: { filename: "chrome-bridge/failure.webm" },
    }),
  ).toThrow("wait failed Recording saved: chrome-bridge/failure.webm");
  expect(() =>
    settleRecordedOperation({
      operationError: new Error("wait failed"),
      recordingError: new Error("encoder failed"),
    }),
  ).toThrow("wait failed Recording also failed: encoder failed");
});

test("marks a lifecycle interruption as unknown without implying a safe retry", () => {
  expect(() =>
    settleRecordedOperation({
      operationError: new OperationOutcomeUnknownError("target tab closed"),
      recordingResult: { filename: "chrome-bridge/diagnostic.webm" },
    }),
  ).toThrow(
    "Operation outcome unknown: target tab closed Recording saved: chrome-bridge/diagnostic.webm Inspect current page state before retrying.",
  );
  expect(() =>
    settleRecordedOperation({
      operationError: new OperationOutcomeUnknownError("target tab closed"),
      recordingError: new Error("capture stopped"),
    }),
  ).toThrow(
    "Operation outcome unknown: target tab closed Recording also failed: capture stopped Inspect current page state before retrying.",
  );
});

test("rejects paths, controls, missing suffixes, and oversized UTF-8 names", () => {
  for (const filename of [
    "",
    ".",
    "..",
    "../escape.webm",
    "folder/video.webm",
    "folder\\video.webm",
    "video.mp4",
    "bad\nname.webm",
    `${"界".repeat(66)}.webm`,
  ]) {
    expect(() => validateRecordingFilename(filename)).toThrow();
  }
});

test("rejects recording durations outside the command timeout budget", () => {
  for (const duration of [0.49, 10.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => validateRecordingDuration(duration)).toThrow(
      /between 0.5 and 10/,
    );
  }
});

test("returns only the completed Downloads-relative Chrome filename", () => {
  expect(
    recordingFilenameFromDownload({
      filename: "/Users/test/Downloads/chrome-bridge/demo (1).webm",
    }),
  ).toBe("chrome-bridge/demo (1).webm");
  expect(
    recordingFilenameFromDownload({
      filename: "C:\\Users\\test\\Downloads\\chrome-bridge\\demo.webm",
    }),
  ).toBe("chrome-bridge/demo.webm");
  expect(() =>
    recordingFilenameFromDownload({ filename: "/private/uuid" }),
  ).toThrow(/invalid completed download basename/);
  expect(() =>
    recordingFilenameFromDownload({
      filename: "/Users/test/Downloads/elsewhere/demo.webm",
    }),
  ).toThrow(/invalid completed download basename/);
});
