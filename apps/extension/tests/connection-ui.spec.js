import { expect, test } from "@playwright/test";

import { connectionActionPresentation } from "../connection-ui.js";

test("uses the bright default icon only while connected", () => {
  expect(connectionActionPresentation("connected")).toEqual({
    iconPath: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
    },
    title: "Chrome Bridge — Connected",
  });
});

test("uses the gray icon for every non-connected state", () => {
  for (const [status, title] of [
    ["connecting", "Chrome Bridge — Connecting"],
    ["disconnected", "Chrome Bridge — Disconnected"],
    ["error", "Chrome Bridge — Connection error"],
  ]) {
    expect(connectionActionPresentation(status)).toEqual({
      iconPath: {
        16: "icons/disconnected/icon-16.png",
        32: "icons/disconnected/icon-32.png",
      },
      title,
    });
  }
});
