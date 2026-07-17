import { expect, test } from "@playwright/test";

import {
  hasValidRequestId,
  validateExtensionInitialMessage,
  validateExtensionRuntimeMessage,
  validateServerMessage,
} from "../dist/protocol.js";

const id = "123e4567-e89b-42d3-a456-426614174000";

test("accepts every protocol v1 command with exact params", () => {
  const messages = [
    { id, type: "tabs.list", params: {} },
    { id, type: "tabs.open", params: { url: "about:blank", active: false } },
    { id, type: "tabs.close", params: { tabId: 1 } },
    { id, type: "tabs.select", params: { tabId: 1 } },
    { id, type: "tabs.activate", params: { tabId: 1 } },
    { id, type: "page.snapshot", params: {} },
    { id, type: "page.click", params: { element: "Save", ref: "s1e2" } },
    {
      id,
      type: "page.click",
      params: {
        element: "Save",
        ref: "s1e2",
        videoFilename: "click.webm",
      },
    },
    {
      id,
      type: "page.drag",
      params: {
        startElement: "Card",
        startRef: "s1e2",
        endElement: "Done",
        endRef: "s1e3",
      },
    },
    {
      id,
      type: "page.uploadFile",
      params: {
        element: "Add photos",
        ref: "s1e4",
        paths: ["/tmp/one.png", "/tmp/two.png"],
      },
    },
    { id, type: "page.hover", params: { element: "Save", ref: "s1e2" } },
    {
      id,
      type: "page.type",
      params: { element: "Name", ref: "s1e2", text: "Alice", submit: false },
    },
    {
      id,
      type: "page.selectOption",
      params: { element: "Colors", ref: "s1e2", values: ["red"] },
    },
    { id, type: "page.pressKey", params: { key: "Enter" } },
    { id, type: "page.navigate", params: { url: "https://example.com" } },
    { id, type: "page.goBack", params: {} },
    { id, type: "page.goForward", params: {} },
    { id, type: "page.wait", params: { time: 1 } },
    {
      id,
      type: "page.wait",
      params: { time: 1, videoFilename: "wait.webm" },
    },
    { id, type: "page.screenshot", params: {} },
    { id, type: "page.getConsoleLogs", params: {} },
    {
      id,
      type: "page.recordVideo",
      params: { filename: "fixture.webm", duration: 1.5 },
    },
  ];

  expect(messages).toHaveLength(22);
  for (const message of messages)
    expect(validateServerMessage(message)).toBeNull();
});

test("rejects unknown commands, missing params, wrong types, and extra fields", () => {
  const invalid = [
    { id, type: "page.unknown", params: {} },
    { id, type: "tabs.open", params: { url: "about:blank" } },
    { id, type: "tabs.close", params: { tabId: "1" } },
    { id, type: "page.click", params: { element: "Save", ref: "bad" } },
    {
      id,
      type: "page.hover",
      params: {
        element: "Save",
        ref: "s1e2",
        videoFilename: "not-yet-supported.webm",
      },
    },
    { id, type: "page.wait", params: { time: 11 } },
    {
      id,
      type: "page.recordVideo",
      params: { filename: "fixture.webm", duration: 10.1 },
    },
    {
      id,
      type: "page.uploadFile",
      params: { element: "Add", ref: "s1e2", paths: [] },
    },
    { id, type: "tabs.list", params: {}, extra: true },
  ];
  for (const message of invalid) {
    expect(validateServerMessage(message)).not.toBeNull();
  }
});

test("validates protocol v2 lifecycle and exclusive response envelopes", () => {
  expect(
    validateExtensionInitialMessage({
      type: "hello",
      protocolVersion: 2,
      extensionVersion: "0.1.0",
      browserId: id,
      browserLabel: "Work",
    }),
  ).toBeNull();
  expect(validateExtensionRuntimeMessage({ type: "ping" })).toBeNull();
  expect(
    validateExtensionRuntimeMessage({ id, ok: true, result: { closed: true } }),
  ).toBeNull();
  expect(
    validateExtensionRuntimeMessage({ id, ok: false, error: "No tab" }),
  ).toBeNull();
  expect(
    validateExtensionRuntimeMessage({
      id,
      ok: true,
      result: {},
      error: "mixed",
    }),
  ).not.toBeNull();
  expect(
    validateExtensionInitialMessage({
      type: "hello",
      protocolVersion: 1,
      extensionVersion: "0.1.0",
    }),
  ).not.toBeNull();
  expect(
    validateExtensionInitialMessage({
      type: "hello",
      protocolVersion: 2,
      extensionVersion: "0.1.0",
      browserId: id,
      browserLabel: "x".repeat(65),
    }),
  ).not.toBeNull();
  expect(
    validateExtensionInitialMessage({
      type: "hello",
      protocolVersion: 2,
      extensionVersion: "0.1.0",
      browserId: id,
      browserLabel: "   ",
    }),
  ).not.toBeNull();
});

test("trusts only canonical UUIDv4 request IDs for error correlation", () => {
  expect(hasValidRequestId({ id })).toBe(true);
  expect(hasValidRequestId({ id: "not-a-uuid" })).toBe(false);
  expect(hasValidRequestId(null)).toBe(false);
});
