import { expect, test } from "@playwright/test";

import { fitWithinMediaBounds } from "../media-sizing.js";

for (const [source, expected] of [
  [[1920, 1080], [1920, 1080]],
  [[2560, 1440], [1920, 1080]],
  [[3440, 1440], [1920, 804]],
  [[1080, 1920], [1080, 1920]],
  [[1440, 2560], [1080, 1920]],
  [[1200, 1600], [1080, 1440]],
  [[1200, 1200], [1080, 1080]],
  [[800, 600], [800, 600]],
]) {
  test(`fits ${source[0]}x${source[1]} within orientation bounds`, () => {
    const result = fitWithinMediaBounds(...source);
    expect([result.width, result.height]).toEqual(expected);
  });
}

test("rejects invalid media dimensions", () => {
  expect(() => fitWithinMediaBounds(0, 100)).toThrow(/sourceWidth/);
  expect(() => fitWithinMediaBounds(100, Number.NaN)).toThrow(/sourceHeight/);
});
