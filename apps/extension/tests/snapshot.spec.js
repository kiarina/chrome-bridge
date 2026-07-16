import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const directory = path.dirname(fileURLToPath(import.meta.url));
const harnessPath = path.join(directory, ".generated", "harness.js");

async function installHarness(page) {
  await page.addScriptTag({ path: harnessPath });
}

test("renders strict refs, roles, states, composed DOM, and link URLs", async ({
  page,
}) => {
  await page.setContent(`
    <!doctype html>
    <title>Snapshot fixture</title>
    <style>#pseudo::before { content: "Prefix "; }</style>
    <nav aria-label="Main">
      <a href="/docs">Docs</a>
      <h2>Settings</h2>
      <input aria-label="Email" value="alice@example.com">
      <input aria-label="Subscribed" type="checkbox" checked>
      <button disabled aria-expanded="true">Toggle</button>
      <div role="button" aria-pressed="mixed">Bold</div>
      <div id="pseudo">Content</div>
    </nav>
    <div role="listbox" aria-label="Choices" aria-owns="owned"></div>
    <div id="owned" role="option" aria-selected="true">Owned option</div>
    <snapshot-host><button slot="action">Slotted action</button></snapshot-host>
    <script>
      customElements.define("snapshot-host", class extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: "open" }).innerHTML =
            '<section aria-label="Shadow"><slot name="action"></slot><button>Shadow action</button></section>';
        }
      });
    </script>
  `);
  await installHarness(page);

  const result = await page.evaluate(() =>
    globalThis.chromeBridgeSnapshotTest.generateSnapshot(12),
  );

  expect(result.title).toBe("Snapshot fixture");
  expect(result.snapshot).toContain('navigation "Main"');
  expect(result.snapshot).toMatch(/link "Docs" \[ref=s12e\d+\]/);
  expect(result.snapshot).toContain("- /url: /docs");
  expect(result.snapshot).toMatch(
    /heading "Settings" \[level=2\] \[ref=s12e\d+\]/,
  );
  expect(result.snapshot).toMatch(
    /checkbox "Subscribed" \[checked\] \[ref=s12e\d+\]/,
  );
  expect(result.snapshot).toMatch(
    /button "Toggle" \[disabled\] \[expanded\] \[ref=s12e\d+\]/,
  );
  expect(result.snapshot).toMatch(
    /button "Bold" \[pressed=mixed\] \[ref=s12e\d+\]/,
  );
  expect(result.snapshot).toMatch(
    /option "Owned option" \[selected\] \[ref=s12e\d+\]/,
  );
  expect(result.snapshot).toContain("Slotted action");
  expect(result.snapshot).toContain("Shadow action");
  expect(result.snapshot).toContain("Prefix Content");
  expect(result.snapshot.match(/Owned option/g)).toHaveLength(1);
  expect(result.snapshot.match(/Slotted action/g)).toHaveLength(1);
});

test("rejects stale, missing, malformed, and detached refs", async ({
  page,
}) => {
  await page.setContent('<button id="first">First</button>');
  await installHarness(page);

  const firstRef = await page.evaluate(() => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    const snapshot = runtime.generateSnapshot(1).snapshot;
    return snapshot.match(/ref=(s\d+e\d+)/)[1];
  });

  await expect(
    page.evaluate((ref) => {
      globalThis.chromeBridgeSnapshotTest.generateSnapshot(2);
      globalThis.chromeBridgeSnapshotTest.resolveAriaRef(ref);
    }, firstRef),
  ).rejects.toThrow("Stale aria-ref");

  await expect(
    page.evaluate(() =>
      globalThis.chromeBridgeSnapshotTest.resolveAriaRef("not-a-ref"),
    ),
  ).rejects.toThrow("Invalid aria-ref");

  const currentRef = await page.evaluate(() => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    const snapshot = runtime.generateSnapshot(3).snapshot;
    const ref = snapshot.match(/button "First" \[ref=(s\d+e\d+)\]/)[1];
    document.querySelector("button").remove();
    return ref;
  });
  await expect(
    page.evaluate(
      (ref) => globalThis.chromeBridgeSnapshotTest.resolveAriaRef(ref),
      currentRef,
    ),
  ).rejects.toThrow("Unknown aria-ref");

  await page.evaluate(() =>
    globalThis.chromeBridgeSnapshotTest.clearSnapshotState(),
  );
  await expect(
    page.evaluate(() =>
      globalThis.chromeBridgeSnapshotTest.resolveAriaRef("s3e1"),
    ),
  ).rejects.toThrow("No accessibility snapshot");
});

test("resolves only the referenced duplicate element and shows an isolated arrow cursor", async ({
  page,
}) => {
  await page.setContent(`
    <style>button { display: block; margin: 24px; width: 160px; height: 40px; }</style>
    <button id="first">Duplicate</button>
    <button id="second">Duplicate</button>
  `);
  await installHarness(page);

  const result = await page.evaluate(() => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    const snapshot = runtime.generateSnapshot(9).snapshot;
    const refs = [
      ...snapshot.matchAll(/button "Duplicate" \[ref=(s9e\d+)\]/g),
    ].map((match) => match[1]);
    const point = runtime.prepareClickTarget(refs[1]);
    const hit = document.elementFromPoint(point.x, point.y);
    const cursor = document.querySelector("#chrome-bridge-virtual-cursor");
    const arrow = cursor?.shadowRoot?.querySelector("svg.cursor");
    return {
      refs,
      hitId: hit?.id,
      cursorLeft: cursor?.style.left,
      cursorTop: cursor?.style.top,
      settleMs: point.settleMs,
      hasArrow: Boolean(arrow),
      arrowFill: arrow?.querySelector("path")?.getAttribute("fill"),
      pointerEvents: cursor?.style.pointerEvents,
    };
  });

  expect(result.refs).toHaveLength(2);
  expect(result.hitId).toBe("second");
  expect(result.cursorLeft).toMatch(/px$/);
  expect(result.cursorTop).toMatch(/px$/);
  expect(result.settleMs).toBe(0);
  expect(result.hasArrow).toBe(true);
  expect(result.arrowFill).toBe("#f21b86");
  expect(result.pointerEvents).toBe("none");
});

test("moves the cursor with bounded timing and renders press and drag states", async ({
  page,
}) => {
  await page.setContent(`
    <style>div { all: unset !important; }</style>
    <button style="position:fixed;left:20px;top:20px;width:80px;height:40px">Move</button>
  `);
  await installHarness(page);

  const result = await page.evaluate(() => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    runtime.moveVirtualCursor({ x: 25, y: 30 });
    const moved = runtime.moveVirtualCursor({ x: 425, y: 330 });
    runtime.pressVirtualCursor();
    runtime.setVirtualCursorPressed(true);
    const host = document.querySelector("#chrome-bridge-virtual-cursor");
    const cursor = host.shadowRoot.querySelector(".cursor");
    const ripple = host.shadowRoot.querySelector(".ripple");
    return {
      left: host.style.left,
      top: host.style.top,
      transition: host.style.transition,
      settleMs: moved.settleMs,
      pressed: cursor.classList.contains("pressed"),
      pressing: cursor.classList.contains("pressing"),
      ripple: ripple.classList.contains("active"),
    };
  });

  expect(result.left).toBe("425px");
  expect(result.top).toBe("330px");
  expect(result.settleMs).toBeGreaterThanOrEqual(100);
  expect(result.settleMs).toBeLessThanOrEqual(320);
  expect(result.transition).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
  expect(result).toMatchObject({ pressed: true, pressing: true, ripple: true });
});

test("disables cursor travel animation when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent("<main>Reduced motion</main>");
  await installHarness(page);

  const result = await page.evaluate(() => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    runtime.moveVirtualCursor({ x: 10, y: 10 });
    return runtime.moveVirtualCursor({ x: 500, y: 400 });
  });
  expect(result.settleMs).toBe(0);
});

test("tracks target and operating state without losing dynamic page titles", async ({
  page,
}) => {
  await page.setContent("<!doctype html><title>Original</title><main>Page</main>");
  await installHarness(page);

  await page.evaluate(() =>
    globalThis.chromeBridgeSnapshotTest.setAgentUiState("target"),
  );
  await expect(page).toHaveTitle("◉ Original");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector("#chrome-bridge-agent-indicator")
            ?.shadowRoot?.querySelector(".label")?.textContent,
      ),
    )
    .toBe("Agent target");

  await page.evaluate(() => {
    document.title = "Updated by page";
  });
  await expect(page).toHaveTitle("◉ Updated by page");

  const operating = await page.evaluate(() => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    runtime.setAgentUiState("operating");
    const host = document.querySelector("#chrome-bridge-agent-indicator");
    return {
      title: document.title,
      logicalTitle: runtime.getLogicalDocumentTitle(),
      label: host.shadowRoot.querySelector(".label").textContent,
      state: host.shadowRoot.querySelector(".indicator").dataset.state,
      dotColor: globalThis.getComputedStyle(
        host.shadowRoot.querySelector(".dot"),
      ).backgroundColor,
    };
  });
  expect(operating).toEqual({
    title: "● Updated by page",
    logicalTitle: "Updated by page",
    label: "Agent operating",
    state: "operating",
    dotColor: "rgb(184, 15, 98)",
  });

  await page.evaluate(() =>
    globalThis.chromeBridgeSnapshotTest.setAgentUiState("off"),
  );
  await expect(page).toHaveTitle("Updated by page");
  expect(
    await page.locator("#chrome-bridge-agent-indicator").count(),
  ).toBe(0);
});

test("hides only the status indicator while preparing a screenshot", async ({
  page,
}) => {
  await page.setContent("<!doctype html><title>Capture</title><main>Page</main>");
  await installHarness(page);

  const result = await page.evaluate(async () => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    runtime.setAgentUiState("target");
    runtime.moveVirtualCursor({ x: 80, y: 90 });
    await runtime.setIndicatorHiddenForCapture(true);
    const indicator = document.querySelector(
      "#chrome-bridge-agent-indicator",
    );
    const cursor = document.querySelector("#chrome-bridge-virtual-cursor");
    const hidden = {
      indicator: indicator.style.visibility,
      cursorHidden: cursor.style.visibility === "hidden",
    };
    await runtime.setIndicatorHiddenForCapture(false);
    return { hidden, restored: indicator.style.visibility };
  });

  expect(result.hidden).toEqual({ indicator: "hidden", cursorHidden: false });
  expect(result.restored).toBe("visible");
});

test("resolves exact drag endpoints and moves the virtual cursor", async ({
  page,
}) => {
  await page.setContent(`
    <style>
      button, [role=region] { display: inline-block; margin: 20px; width: 140px; height: 60px; }
    </style>
    <button draggable="true">Source card</button>
    <section role="region" aria-label="Done column"><span>Drop here</span></section>
  `);
  await installHarness(page);

  const result = await page.evaluate(() => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    const snapshot = runtime.generateSnapshot(30).snapshot;
    const startRef = snapshot.match(
      /button "Source card" \[ref=(s30e\d+)\]/,
    )[1];
    const endRef = snapshot.match(/region "Done column" \[ref=(s30e\d+)\]/)[1];
    const points = runtime.prepareDragTargets(startRef, endRef);
    const startHit = document.elementFromPoint(points.start.x, points.start.y);
    const endHit = document.elementFromPoint(points.end.x, points.end.y);
    runtime.moveVirtualCursor(points.end);
    const cursor = document.querySelector("#chrome-bridge-virtual-cursor");
    return {
      startText: startHit?.textContent,
      endText: endHit?.textContent,
      cursorLeft: cursor?.style.left,
      cursorTop: cursor?.style.top,
      points,
    };
  });

  expect(result.startText).toContain("Source card");
  expect(result.endText).toContain("Drop here");
  expect(result.cursorLeft).toBe(`${result.points.end.x}px`);
  expect(result.cursorTop).toBe(`${result.points.end.y}px`);
});

test("rejects a drag target outside the viewport after scrolling the source", async ({
  page,
}) => {
  await page.setContent(`
    <button draggable="true">Visible source</button>
    <section role="region" aria-label="Far target" style="position:absolute;top:3000px;width:100px;height:100px"></section>
  `);
  await installHarness(page);

  const refs = await page.evaluate(() => {
    const snapshot =
      globalThis.chromeBridgeSnapshotTest.generateSnapshot(31).snapshot;
    return {
      start: snapshot.match(/button "Visible source" \[ref=(s31e\d+)\]/)[1],
      end: snapshot.match(/region "Far target" \[ref=(s31e\d+)\]/)[1],
    };
  });

  await expect(
    page.evaluate(({ start, end }) => {
      globalThis.chromeBridgeSnapshotTest.prepareDragTargets(start, end);
    }, refs),
  ).rejects.toThrow("End element for aria-ref is not visible");
});

test("rejects an element covered by another element", async ({ page }) => {
  await page.setContent(`
    <button id="covered" style="width: 160px; height: 40px">Covered</button>
    <div style="position: fixed; inset: 0; z-index: 10"></div>
  `);
  await installHarness(page);

  await expect(
    page.evaluate(() => {
      const runtime = globalThis.chromeBridgeSnapshotTest;
      const snapshot = runtime.generateSnapshot(4).snapshot;
      const ref = snapshot.match(/button "Covered" \[ref=(s4e\d+)\]/)[1];
      runtime.prepareClickTarget(ref);
    }),
  ).rejects.toThrow("not clickable");
});

test("waits for a full idle interval after the last DOM mutation", async ({
  page,
}) => {
  await page.setContent("<main>Initial</main>");
  await installHarness(page);

  const result = await page.evaluate(async () => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    const startedAt = performance.now();
    const waiting = runtime.waitForStableDOM(100, 1_000);
    setTimeout(() => {
      document.querySelector("main").textContent = "First";
    }, 40);
    setTimeout(() => {
      document.querySelector("main").textContent = "Second";
    }, 100);
    const stable = await waiting;
    return { ...stable, wallTime: performance.now() - startedAt };
  });

  expect(result.stable).toBe(true);
  expect(result.wallTime).toBeGreaterThanOrEqual(190);
  expect(result.wallTime).toBeLessThan(1_000);
});

test("validates editable refs before typing", async ({ page }) => {
  await page.setContent(`
    <input aria-label="Name">
    <button>Not editable</button>
  `);
  await installHarness(page);

  const result = await page.evaluate(() => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    const snapshot = runtime.generateSnapshot(20).snapshot;
    const inputRef = snapshot.match(/textbox "Name" \[ref=(s20e\d+)\]/)[1];
    const buttonRef = snapshot.match(
      /button "Not editable" \[ref=(s20e\d+)\]/,
    )[1];
    const point = runtime.prepareTypeTarget(inputRef);
    return { point, buttonRef };
  });

  expect(result.point.x).toBeGreaterThanOrEqual(0);
  await expect(
    page.evaluate((ref) => {
      globalThis.chromeBridgeSnapshotTest.prepareTypeTarget(ref);
    }, result.buttonRef),
  ).rejects.toThrow("not editable");
});

test("selects exact option values and dispatches input and change", async ({
  page,
}) => {
  await page.setContent(`
    <select aria-label="Colors" multiple>
      <option value="red">Red</option>
      <option value="green">Green</option>
      <option value="blue">Blue</option>
    </select>
    <script>
      globalThis.events = [];
      document.querySelector('select').addEventListener('input', () => events.push('input'));
      document.querySelector('select').addEventListener('change', () => events.push('change'));
    </script>
  `);
  await installHarness(page);

  const result = await page.evaluate(() => {
    const runtime = globalThis.chromeBridgeSnapshotTest;
    const snapshot = runtime.generateSnapshot(21).snapshot;
    const ref = snapshot.match(/listbox "Colors" \[ref=(s21e\d+)\]/)[1];
    const values = runtime.selectOptions(ref, ["red", "blue"]);
    return { values, events: globalThis.events };
  });

  expect(result.values).toEqual(["red", "blue"]);
  expect(result.events).toEqual(["input", "change"]);

  await expect(
    page.evaluate(() => {
      const runtime = globalThis.chromeBridgeSnapshotTest;
      const snapshot = runtime.generateSnapshot(22).snapshot;
      const ref = snapshot.match(/listbox "Colors" \[ref=(s22e\d+)\]/)[1];
      runtime.selectOptions(ref, ["missing"]);
    }),
  ).rejects.toThrow("Unable to find option");
});

test("resizes PNG screenshots within the configured pixel bounds", async ({
  page,
}) => {
  await page.setContent("<main>Screenshot fixture</main>");
  await installHarness(page);

  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 20;
    canvas.height = 10;
    const context = canvas.getContext("2d");
    context.fillStyle = "#00aa44";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const source = canvas.toDataURL("image/png").split(",", 2)[1];
    const resized = await globalThis.chromeBridgeSnapshotTest.resizePng(
      source,
      10,
      10,
    );
    const response = await fetch(`data:image/png;base64,${resized.data}`);
    const bitmap = await createImageBitmap(await response.blob());
    const decoded = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { ...resized, decoded };
  });

  expect(result.width).toBe(10);
  expect(result.height).toBe(5);
  expect(result.decoded).toEqual({ width: 10, height: 5 });
  expect(result.data).not.toMatch(/^data:/);
});
