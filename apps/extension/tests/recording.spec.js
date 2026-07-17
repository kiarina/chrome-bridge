import { expect, test } from "@playwright/test";

import {
  recordingDownloadPath,
  recordingFilenameFromDownload,
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
