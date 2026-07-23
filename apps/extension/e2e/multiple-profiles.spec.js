import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  connectMcp,
  launchProfile,
  prepareExtensionArtifact,
  reserveLoopbackPort,
  runSdkProbe,
  startFixtureServer,
  startServer,
  toolCaller,
  toolText,
  toolValue,
  waitFor,
} from "./harness.js";

test("stays quietly disconnected until the server starts", async () => {
  const profiles = [];
  let artifact;
  let server;
  try {
    const port = await reserveLoopbackPort();
    const extensionUrl = `ws://127.0.0.1:${port}/extension`;
    artifact = await prepareExtensionArtifact(extensionUrl);
    const profile = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("offline"),
      name: "offline-profile",
      viewport: { width: 1_280, height: 720 },
    });
    profiles.push(profile);

    await expect.poll(() => profile.worker.evaluate(async () =>
      (await chrome.storage.local.get("connectionStatus")).connectionStatus,
    )).toMatchObject({
      status: "disconnected",
      detail: `Server unavailable at ${extensionUrl}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(profile.logs.filter((line) => line.startsWith("[worker error]")))
      .toEqual([]);
    await expect.poll(() => profile.worker.evaluate(async () =>
      Boolean(await chrome.alarms.get("chrome-bridge-connection-retry")),
    )).toBe(true);

    server = await startServer({ port });
    await expect.poll(async () => (await health(server)).connectedBrowserCount, {
      timeout: 15_000,
    }).toBe(1);
    await expect.poll(() => profile.worker.evaluate(async () =>
      (await chrome.storage.local.get("connectionStatus")).connectionStatus,
    )).toMatchObject({ status: "connected", detail: extensionUrl });
    expect(profile.logs.some((line) => line.includes("WebSocket connection")))
      .toBe(false);
  } finally {
    await Promise.allSettled(profiles.map((profile) => profile.close()));
    await server?.close();
    await artifact?.close();
  }
});

async function health(server) {
  const response = await fetch(`${server.httpUrl}/health`);
  expect(response.ok).toBe(true);
  return response.json();
}

function successful(result) {
  expect(result.isError, toolText(result)).not.toBe(true);
  return toolValue(result);
}

function pngMetrics(result) {
  expect(result.isError, toolText(result)).not.toBe(true);
  const image = result.content.find((item) => item.type === "image");
  expect(image).toMatchObject({ mimeType: "image/png" });
  const png = Buffer.from(image.data, "base64");
  expect([...png.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return {
    base64Length: image.data.length,
    height: png.readUInt32BE(20),
    sizeBytes: png.byteLength,
    width: png.readUInt32BE(16),
  };
}

function buttonRef(snapshot) {
  const match = snapshot.snapshot.match(/button "Update"[^\n]*\[ref=([^\]]+)\]/);
  expect(match, snapshot.snapshot).not.toBeNull();
  return match[1];
}

function expectStatus(snapshot, value) {
  expect(snapshot.snapshot).toMatch(new RegExp(`status[^\\n]*: ${value}`));
}

function refFor(snapshot, pattern) {
  const match = snapshot.snapshot.match(pattern);
  expect(match, snapshot.snapshot).not.toBeNull();
  return match[1];
}

async function fixturePage(profile, url) {
  return waitFor(
    () => Promise.resolve(profile.context.pages().find((page) => page.url() === url)),
    Boolean,
    `fixture page ${url}`,
  );
}

async function recordFixture(call, page, browserId, filename, duration = 1.5) {
  await page.evaluate(() => {
    let frame = 0;
    globalThis.recordingProbeTimer = setInterval(() => {
      frame += 1;
      document.querySelector("[role=status]").textContent = `Recording frame ${frame}`;
    }, 100);
  });
  try {
    return successful(
      await call("browser_record_video", {
        browser_id: browserId,
        filename,
        duration,
      }),
    );
  } finally {
    await page.evaluate(() => {
      clearInterval(globalThis.recordingProbeTimer);
      document.querySelector("[role=status]").textContent = "Ready";
    });
  }
}

async function removeProbeDownload(profile, downloadId) {
  await profile.worker.evaluate(async ({ id }) => {
    await chrome.downloads.removeFile(id);
    await chrome.downloads.erase({ id });
  }, { id: downloadId });
}

async function downloadState(profile) {
  return profile.worker.evaluate(async () => ({
    count: (await chrome.downloads.search({})).length,
    latest: (await chrome.downloads.search({
      state: "complete",
      orderBy: ["-startTime"],
      limit: 1,
    })).map((item) => ({ filename: item.filename, id: item.id }))[0],
  }));
}

async function verifyAndRemoveDiagnostic(profile, previousCount) {
  const downloads = await downloadState(profile);
  expect(downloads.count).toBe(previousCount + 1);
  const webm = await readFile(downloads.latest.filename);
  expect([...webm.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  await removeProbeDownload(profile, downloads.latest.id);
}

async function measureInputDelay(profile, tabId) {
  return profile.worker.evaluate(
    ({ currentTabId }) =>
      globalThis.__chromeBridgeRecordingProbe.measureInputDelayProbe({
        tabId: currentTabId,
        sampleCount: 5,
      }),
    { currentTabId: tabId },
  );
}

async function measureNavigationLifecycle(profile, tabId, urlA, urlB) {
  return profile.worker.evaluate(
    (params) =>
      globalThis.__chromeBridgeRecordingProbe.measureNavigationLifecycleProbe(params),
    { tabId, urlA, urlB },
  );
}

async function waitForNavigationStarted(profile, tabId, expectedUrl) {
  await expect.poll(() => profile.worker.evaluate(
    async ({ targetTabId, targetUrl }) => {
      const tab = await chrome.tabs.get(targetTabId);
      return tab.status === "loading"
        && [tab.url, tab.pendingUrl].includes(targetUrl);
    },
    { targetTabId: tabId, targetUrl: expectedUrl },
  )).toBe(true);
}

async function verifyRecording(
  profile,
  recording,
  expectedSize,
  expectedBrowserId,
  expectedDuration,
  label,
) {
  expect(recording).toMatchObject({
    requestedFilename: expect.stringMatching(/\.webm$/),
    filename: expect.stringMatching(/^chrome-bridge\/.+\.webm$/),
    mimeType: "video/webm",
    width: expectedSize.width,
    height: expectedSize.height,
    browserId: expectedBrowserId,
  });
  expect(recording.frameCount).toBeGreaterThan(0);
  expect(recording.droppedFrameCount).toBeGreaterThanOrEqual(0);
  expect(recording.sizeBytes).toBeGreaterThan(1_000);
  expect(recording.durationMs).toBeGreaterThanOrEqual(
    expectedDuration * 1_000 - 100,
  );
  const download = await profile.worker.evaluate(async () => {
    const [item] = await chrome.downloads.search({
      state: "complete",
      orderBy: ["-startTime"],
      limit: 1,
    });
    return item ? { id: item.id, filename: item.filename } : null;
  });
  expect(download).not.toBeNull();
  const webm = await readFile(download.filename);
  expect(webm.byteLength).toBe(recording.sizeBytes);
  expect([...webm.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  console.log(`${label} production recording metrics`, JSON.stringify({
    blobSize: recording.sizeBytes,
    elapsedMs: recording.durationMs,
    frameCount: recording.frameCount,
    skippedFrames: recording.droppedFrameCount,
    output: `${recording.width}x${recording.height}`,
  }));
  await removeProbeDownload(profile, download.id);
}

function verifyInputDelay(measurement, expectedSize, label) {
  expect(measurement).toMatchObject({
    sampleCount: 5,
    sourceWidth: expectedSize.width,
    sourceHeight: expectedSize.height,
  });
  expect(measurement.samples).toHaveLength(5);
  expect(measurement.maxInputQueueDelayMs).toBeLessThan(1_000);
  expect(measurement.maxInputCommandMs).toBeLessThan(500);
  console.log(`${label} input-delay probe metrics`, JSON.stringify({
    maxCaptureMs: Math.round(measurement.maxCaptureMs),
    maxInputCommandMs: Math.round(measurement.maxInputCommandMs),
    maxInputQueueDelayMs: Math.round(measurement.maxInputQueueDelayMs),
    meanCaptureMs: Math.round(measurement.meanCaptureMs),
    meanInputCommandMs: Math.round(measurement.meanInputCommandMs),
    meanInputQueueDelayMs: Math.round(measurement.meanInputQueueDelayMs),
    source: `${measurement.sourceWidth}x${measurement.sourceHeight}`,
  }));
}

test("routes two isolated Chrome profiles and preserves identity across restart", async ({}, testInfo) => {
  const transcript = [];
  const profiles = [];
  let server;
  let fixture;
  let artifact;
  let client;
  let failure;

  try {
    server = await startServer();
    expect(await health(server)).toEqual({
      status: "ok",
      extensionConnected: false,
      connectedBrowserCount: 0,
      extension: {},
    });
    fixture = await startFixtureServer();
    artifact = await prepareExtensionArtifact(server.extensionUrl);
    const uploadPaths = [
      path.join(artifact.rootDir, "upload-one.txt"),
      path.join(artifact.rootDir, "upload-two.txt"),
    ];
    await Promise.all([
      writeFile(uploadPaths[0], "first upload"),
      writeFile(uploadPaths[1], "second upload"),
    ]);

    let profileA = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("a"),
      name: "profile-a",
      viewport: { width: 1_920, height: 1_080 },
    });
    profiles.push(profileA);
    client = await connectMcp(server.mcpUrl);
    const call = toolCaller(client, transcript);
    const instances = async () => successful(await call("browser_instances"));
    const onlyA = await waitFor(instances, (items) => items.length === 1, "profile A connection");
    const browserA = onlyA[0].browserId;

    let profileB = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("b"),
      name: "profile-b",
      viewport: { width: 1_080, height: 1_920 },
    });
    profiles.push(profileB);

    const connected = await waitFor(instances, (items) => items.length === 2, "two browser instances");
    expect(connected).toHaveLength(2);
    const sdkInstances = await runSdkProbe(server.httpUrl);
    expect(new Set(sdkInstances.map((item) => item.browserId)))
      .toEqual(new Set(connected.map((item) => item.browserId)));
    await expect.poll(() => profileA.worker.evaluate(async () => ({
      status: (await chrome.storage.local.get("connectionStatus")).connectionStatus?.status,
      title: await chrome.action.getTitle({}),
    }))).toEqual({ status: "connected", title: "Chrome Bridge — Connected" });
    for (const instance of connected) {
      expect(instance).toMatchObject({
        protocolVersion: 2,
        extensionVersion: "0.3.0",
        identityStable: true,
      });
      expect(instance.browserId).toMatch(/^[0-9a-f-]{36}$/);
    }
    const browserB = connected.find((instance) => instance.browserId !== browserA).browserId;
    expect(browserA).not.toBe(browserB);

    const ambiguous = await call("browser_tabs");
    expect(ambiguous.isError).toBe(true);
    expect(toolText(ambiguous)).toContain("Multiple Chrome browsers are connected");

    const initialTabsA = successful(await call("browser_tabs", { browser_id: browserA }));
    const initialTabsB = successful(await call("browser_tabs", { browser_id: browserB }));
    const activeA = initialTabsA.find((tab) => tab.active).id;
    const activeB = initialTabsB.find((tab) => tab.active).id;

    const openedA = successful(await call("browser_tab_open", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
      active: false,
    }));
    const openedB = successful(await call("browser_tab_open", {
      browser_id: browserB,
      url: `${fixture.baseUrl}/b`,
      active: false,
    }));
    expect(openedA).toMatchObject({ active: false, browserId: browserA });
    expect(openedB).toMatchObject({ active: false, browserId: browserB });

    expect(successful(await call("browser_tab_select", {
      browser_id: browserA,
      tab_id: openedA.id,
    }))).toMatchObject({ id: openedA.id, active: false, targeted: true, browserId: browserA });
    expect(successful(await call("browser_tab_select", {
      browser_id: browserB,
      tab_id: openedB.id,
    }))).toMatchObject({ id: openedB.id, active: false, targeted: true, browserId: browserB });

    const pageA = await fixturePage(profileA, `${fixture.baseUrl}/a`);
    const pageB = await fixturePage(profileB, `${fixture.baseUrl}/b`);
    await expect.poll(() => pageA.title()).toBe("◉ Chrome Bridge E2E");
    expect(await pageA.locator("#chrome-bridge-agent-indicator").count()).toBe(0);

    const waitingA = call("browser_wait", { browser_id: browserA, time: 0.5 });
    await expect.poll(() => pageA.title()).toBe("● Chrome Bridge E2E");
    expect(await pageA.locator("#chrome-bridge-agent-indicator").count()).toBe(0);
    expect(successful(await waitingA)).toBe("Waited for 0.5 seconds");
    await expect.poll(() => pageA.title()).toBe("◉ Chrome Bridge E2E");

    const beforeWaitFor = successful(await call("browser_snapshot", {
      browser_id: browserA,
    }));
    const staleAfterWaitFor = buttonRef(beforeWaitFor);
    await pageA.evaluate(() => {
      setTimeout(() => {
        document.querySelector("[role=status]").textContent =
          "Payment   complete";
      }, 200);
    });
    const waitedVisible = successful(await call("browser_wait_for", {
      browser_id: browserA,
      text: "Payment complete",
      state: "visible",
      timeout: 2,
    }));
    expect(waitedVisible).toMatchObject({ browserId: browserA });
    expect(waitedVisible.snapshot).toContain("Payment complete");
    const staleClick = await call("browser_click", {
      browser_id: browserA,
      element: "Update button",
      ref: staleAfterWaitFor,
    });
    expect(staleClick.isError).toBe(true);
    expect(toolText(staleClick)).toContain("Stale aria-ref");
    await pageA.evaluate(() => {
      setTimeout(() => {
        document.querySelector("[role=status]").textContent = "Ready again";
      }, 200);
    });
    const waitedHidden = successful(await call("browser_wait_for", {
      browser_id: browserA,
      text: "Payment complete",
      state: "hidden",
      timeout: 2,
      video_filename: "wait-for-hidden.webm",
    }));
    expect(waitedHidden.operation.snapshot).not.toContain("Payment complete");
    await verifyRecording(
      profileA,
      waitedHidden.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded wait-for",
    );

    const downloadRef = refFor(
      waitedHidden.operation,
      /link "Export report"[^\n]*\[ref=([^\]]+)\]/,
    );
    const downloaded = successful(await call("browser_download_file", {
      browser_id: browserA,
      element: "Export report link",
      ref: downloadRef,
      timeout: 10,
    }));
    expect(downloaded.download).toMatchObject({
      suggestedFilename: "report.csv",
      state: "complete",
      browserId: browserA,
    });
    expect(downloaded.download.receivedBytes).toBeGreaterThan(0);
    expect(downloaded.snapshot).toMatchObject({ browserId: browserA });
    const firstDownload = await downloadState(profileA);
    expect((await readFile(firstDownload.latest.filename)).toString()).toContain(
      "report,42",
    );
    await removeProbeDownload(profileA, firstDownload.latest.id);

    const delayedRef = refFor(
      downloaded.snapshot,
      /link "Export delayed report"[^\n]*\[ref=([^\]]+)\]/,
    );
    const delayedDownload = successful(await call("browser_download_file", {
      browser_id: browserA,
      element: "Export delayed report link",
      ref: delayedRef,
      timeout: 3,
    }));
    expect(delayedDownload.download).toMatchObject({
      suggestedFilename: "delayed.csv",
      state: "complete",
      browserId: browserA,
    });
    const secondDownload = await downloadState(profileA);
    await removeProbeDownload(profileA, secondDownload.latest.id);

    const timeoutRef = refFor(
      delayedDownload.snapshot,
      /link "Export timeout report"[^\n]*\[ref=([^\]]+)\]/,
    );
    const timedOutDownload = await call("browser_download_file", {
      browser_id: browserA,
      element: "Export timeout report link",
      ref: timeoutRef,
      timeout: 0.1,
    });
    expect(timedOutDownload.isError).toBe(true);
    expect(toolText(timedOutDownload)).toContain("Operation outcome unknown");
    expect(successful(await call("browser_snapshot", {
      browser_id: browserA,
    }))).toMatchObject({ browserId: browserA });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const timeoutDownload = await downloadState(profileA);
    if (timeoutDownload.latest) {
      await removeProbeDownload(profileA, timeoutDownload.latest.id);
    }

    const recordedWait = successful(await call("browser_wait", {
      browser_id: browserA,
      time: 10,
      video_filename: "recorded-wait.webm",
    }));
    expect(recordedWait.operation).toBe("Waited for 10 seconds");
    await verifyRecording(
      profileA,
      recordedWait.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      10.9,
      "recorded wait",
    );
    await expect.poll(() => pageA.title()).toBe("◉ Chrome Bridge E2E");

    await pageA.evaluate(() => {
      const spacer = document.createElement("section");
      spacer.id = "scroll-recording-fixture";
      spacer.style.cssText = [
        "height: 4000px",
        "background: linear-gradient(#2255aa, #22aa66)",
        "position: relative",
      ].join(";");
      spacer.innerHTML = [
        '<p style="position:absolute;top:2600px;color:white;font-size:48px">',
        "Scrolled recording viewport",
        "</p>",
      ].join("");
      document.body.append(spacer);
      globalThis.scrollTo(0, 2800);
    });
    await expect.poll(() => pageA.evaluate(() => globalThis.scrollY))
      .toBeGreaterThan(2_000);
    await pageA.evaluate(async () => {
      await new Promise((resolve) => {
        globalThis.requestAnimationFrame(() => {
          globalThis.requestAnimationFrame(resolve);
        });
      });
      const initial = globalThis.scrollY;
      globalThis.scrollRecordingProbe = {
        initial,
        min: initial,
        max: initial,
        events: 0,
        active: true,
      };
      globalThis.scrollRecordingListener = () => {
        globalThis.scrollRecordingProbe.events += 1;
      };
      globalThis.addEventListener("scroll", globalThis.scrollRecordingListener);
      const sample = () => {
        const probe = globalThis.scrollRecordingProbe;
        if (!probe?.active) return;
        probe.min = Math.min(probe.min, globalThis.scrollY);
        probe.max = Math.max(probe.max, globalThis.scrollY);
        globalThis.scrollRecordingFrame = globalThis.requestAnimationFrame(sample);
      };
      globalThis.scrollRecordingFrame = globalThis.requestAnimationFrame(sample);
    });
    const scrolledScreenshot = await call("browser_screenshot", {
      browser_id: browserA,
    });
    expect(scrolledScreenshot.isError, toolText(scrolledScreenshot)).not.toBe(true);
    const scrolledScreenshotImage = scrolledScreenshot.content.find(
      (item) => item.type === "image",
    );
    expect(scrolledScreenshotImage).toMatchObject({ mimeType: "image/png" });
    const scrolledCenterPixel = await pageA.evaluate(async (data) => {
      const response = await globalThis.fetch(`data:image/png;base64,${data}`);
      const bitmap = await globalThis.createImageBitmap(await response.blob());
      try {
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        return [...context.getImageData(
          Math.floor(bitmap.width / 2),
          Math.floor(bitmap.height / 2),
          1,
          1,
        ).data];
      } finally {
        bitmap.close();
      }
    }, scrolledScreenshotImage.data);
    expect(scrolledCenterPixel[0]).toBeLessThan(100);
    expect(scrolledCenterPixel[3]).toBe(255);
    const scrolledRecordedWait = successful(await call("browser_wait", {
      browser_id: browserA,
      time: 0.5,
      video_filename: "scrolled-recorded-wait.webm",
    }));
    expect(scrolledRecordedWait.operation).toBe("Waited for 0.5 seconds");
    await verifyRecording(
      profileA,
      scrolledRecordedWait.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1.4,
      "scrolled recorded wait",
    );
    const scrollRecordingProbe = await pageA.evaluate(() => {
      globalThis.scrollRecordingProbe.active = false;
      globalThis.cancelAnimationFrame(globalThis.scrollRecordingFrame);
      globalThis.removeEventListener("scroll", globalThis.scrollRecordingListener);
      return { ...globalThis.scrollRecordingProbe, final: globalThis.scrollY };
    });
    expect(scrollRecordingProbe).toEqual({
      initial: scrollRecordingProbe.initial,
      min: scrollRecordingProbe.initial,
      max: scrollRecordingProbe.initial,
      final: scrollRecordingProbe.initial,
      events: 0,
      active: false,
    });
    await pageA.evaluate(() => {
      document.querySelector("#scroll-recording-fixture")?.remove();
      globalThis.scrollTo(0, 0);
      delete globalThis.scrollRecordingProbe;
      delete globalThis.scrollRecordingListener;
      delete globalThis.scrollRecordingFrame;
    });

    const navigationLifecycle = await measureNavigationLifecycle(
      profileA,
      openedA.id,
      `${fixture.baseUrl}/a`,
      `${fixture.baseUrl}/b`,
    );
    expect(navigationLifecycle.detachEvents).toEqual([]);
    expect(new Set(navigationLifecycle.states.map((state) => state.targetId)).size)
      .toBe(1);
    expect(navigationLifecycle.states.every((state) => state.attached)).toBe(true);
    expect(navigationLifecycle.states[0].loaderId)
      .toBe(navigationLifecycle.states[1].loaderId);
    expect(navigationLifecycle.states[2].loaderId)
      .not.toBe(navigationLifecycle.states[1].loaderId);
    for (const capture of Object.values(navigationLifecycle.captures)) {
      expect(capture.sampleCount).toBeGreaterThan(0);
      expect(capture.successes).toBeGreaterThan(0);
    }
    expect(successful(await call("browser_tabs", { browser_id: browserA }))
      .find((tab) => tab.active).id).toBe(activeA);
    console.log("navigation lifecycle probe metrics", JSON.stringify(
      navigationLifecycle,
    ));

    const recordedNavigate = successful(await call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/b`,
      video_filename: "recorded-navigate.webm",
    }));
    expect(recordedNavigate.operation.url).toBe(`${fixture.baseUrl}/b`);
    await verifyRecording(
      profileA,
      recordedNavigate.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded navigate",
    );
    const historyStartA = successful(await call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
    }));
    const historyDestinationA = successful(await call("browser_click", {
      browser_id: browserA,
      element: "History destination link",
      ref: refFor(
        historyStartA,
        /link "History destination"[^\n]*\[ref=([^\]]+)\]/,
      ),
    }));
    expect(historyDestinationA.url).toBe(`${fixture.baseUrl}/b`);
    const recordedBack = successful(await call("browser_go_back", {
      browser_id: browserA,
      video_filename: "recorded-back.webm",
    }));
    expect(recordedBack.operation.url).toBe(`${fixture.baseUrl}/a`);
    await verifyRecording(
      profileA,
      recordedBack.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded back",
    );
    const recordedForward = successful(await call("browser_go_forward", {
      browser_id: browserA,
      video_filename: "recorded-forward.webm",
    }));
    expect(recordedForward.operation.url).toBe(`${fixture.baseUrl}/b`);
    await verifyRecording(
      profileA,
      recordedForward.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded forward",
    );
    successful(await call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
    }));

    const downloadsBeforeFailedNavigation = (await downloadState(profileA)).count;
    const failedNavigation = await call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/fail`,
      video_filename: "failed-navigation.webm",
    });
    expect(failedNavigation.isError).toBe(true);
    expect(toolText(failedNavigation)).toContain("Target navigation failed:");
    if (toolText(failedNavigation).includes("Recording saved:")) {
      await verifyAndRemoveDiagnostic(profileA, downloadsBeforeFailedNavigation);
    } else {
      expect(toolText(failedNavigation)).toMatch(/Recording also failed: .+/);
      expect((await downloadState(profileA)).count)
        .toBe(downloadsBeforeFailedNavigation);
    }
    successful(await call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
    }));

    const downloadsBeforeTimedOutNavigation = (await downloadState(profileA)).count;
    const timedOutNavigationStartedAt = performance.now();
    const timedOutNavigation = await call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/timeout-a`,
      video_filename: "timed-out-navigation.webm",
    });
    expect(timedOutNavigation.isError).toBe(true);
    expect(toolText(timedOutNavigation)).toContain("Operation outcome unknown:");
    expect(toolText(timedOutNavigation)).toContain(
      "Target navigation did not complete within 7 seconds",
    );
    expect(performance.now() - timedOutNavigationStartedAt).toBeLessThan(15_000);
    if (toolText(timedOutNavigation).includes("Recording saved:")) {
      await verifyAndRemoveDiagnostic(profileA, downloadsBeforeTimedOutNavigation);
    } else {
      expect(toolText(timedOutNavigation)).toContain("Recording also failed:");
      expect((await downloadState(profileA)).count)
        .toBe(downloadsBeforeTimedOutNavigation);
    }

    const recoveredRecording = successful(await call("browser_wait", {
      browser_id: browserA,
      time: 0.5,
      video_filename: "after-navigation-timeout.webm",
    }));
    expect(recoveredRecording.operation).toBe("Waited for 0.5 seconds");
    await verifyRecording(
      profileA,
      recoveredRecording.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1.5,
      "recording after navigation timeout",
    );

    const navigationTargetChangeTab = successful(await call("browser_tab_open", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/b`,
      active: false,
    }));
    const downloadsBeforeNavigationTargetChange = (await downloadState(profileA)).count;
    const targetChangedNavigation = call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/slow-a`,
      video_filename: "target-changed-navigation.webm",
    });
    await waitForNavigationStarted(
      profileA,
      openedA.id,
      `${fixture.baseUrl}/slow-a`,
    );
    // The server-wide coordinator intentionally prevents another API/MCP call from
    // entering during navigation. Mutate the test profile's session state directly to
    // retain coverage of the extension's external target-loss diagnostic boundary.
    await profileA.worker.evaluate(async ({ tabId }) => {
      await chrome.storage.session.set({ targetTabId: tabId });
      await chrome.storage.session.remove("latestSnapshot");
    }, { tabId: navigationTargetChangeTab.id });
    const targetChangedNavigationResult = await targetChangedNavigation;
    expect(targetChangedNavigationResult.isError).toBe(true);
    expect(toolText(targetChangedNavigationResult)).toContain(
      "Operation outcome unknown:",
    );
    expect(toolText(targetChangedNavigationResult)).toContain("Recording saved:");
    await verifyAndRemoveDiagnostic(
      profileA,
      downloadsBeforeNavigationTargetChange,
    );
    expect((await call("browser_screenshot", { browser_id: browserA })).isError)
      .not.toBe(true);
    successful(await call("browser_tab_select", {
      browser_id: browserA,
      tab_id: openedA.id,
    }));
    successful(await call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
    }));
    expect(successful(await call("browser_tab_close", {
      browser_id: browserA,
      tab_id: navigationTargetChangeTab.id,
    }))).toMatchObject({ closed: true, tabId: navigationTargetChangeTab.id });

    const downloadsBeforeDetachedNavigation = (await downloadState(profileA)).count;
    const detachedNavigation = call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/slow-a`,
      video_filename: "externally-detached-navigation.webm",
    });
    await waitForNavigationStarted(
      profileA,
      openedA.id,
      `${fixture.baseUrl}/slow-a`,
    );
    await profileA.worker.evaluate(async ({ tabId }) => {
      const target = (await chrome.debugger.getTargets()).find(
        (candidate) => candidate.tabId === tabId && candidate.attached,
      );
      if (!target) throw new Error("Recorded navigation debugger is not attached");
      await chrome.debugger.detach({ targetId: target.id });
    }, { tabId: openedA.id });
    const detachedNavigationResult = await detachedNavigation;
    expect(detachedNavigationResult.isError).toBe(true);
    expect(toolText(detachedNavigationResult)).toContain(
      "Operation completed, but recording failed:",
    );
    expect(toolText(detachedNavigationResult)).toContain(
      "Do not retry the operation automatically.",
    );
    expect((await downloadState(profileA)).count)
      .toBe(downloadsBeforeDetachedNavigation);
    expect((await call("browser_screenshot", { browser_id: browserA })).isError)
      .not.toBe(true);
    successful(await call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
    }));

    const closingNavigationTab = successful(await call("browser_tab_open", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
      active: false,
    }));
    successful(await call("browser_tab_select", {
      browser_id: browserA,
      tab_id: closingNavigationTab.id,
    }));
    const downloadsBeforeClosedNavigation = (await downloadState(profileA)).count;
    const closingNavigation = call("browser_navigate", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/slow-a`,
      video_filename: "tab-closed-navigation.webm",
    });
    await waitForNavigationStarted(
      profileA,
      closingNavigationTab.id,
      `${fixture.baseUrl}/slow-a`,
    );
    // Closing the Chrome tab directly models user/browser lifecycle change without
    // waiting behind the server's operation lease.
    await profileA.worker.evaluate(
      async ({ tabId }) => chrome.tabs.remove(tabId),
      { tabId: closingNavigationTab.id },
    );
    const closingNavigationResult = await closingNavigation;
    expect(closingNavigationResult.isError).toBe(true);
    expect(toolText(closingNavigationResult)).toContain(
      "Operation outcome unknown:",
    );
    expect(toolText(closingNavigationResult)).toContain(
      "Inspect current page state before retrying.",
    );
    const closedNavigationDownloads = await downloadState(profileA);
    if (toolText(closingNavigationResult).includes("Recording saved:")) {
      await verifyAndRemoveDiagnostic(profileA, downloadsBeforeClosedNavigation);
    } else {
      expect(toolText(closingNavigationResult)).toContain("Recording also failed:");
      expect(closedNavigationDownloads.count).toBe(downloadsBeforeClosedNavigation);
    }
    successful(await call("browser_tab_select", {
      browser_id: browserA,
      tab_id: openedA.id,
    }));
    expect((await call("browser_screenshot", { browser_id: browserA })).isError)
      .not.toBe(true);

    expect(successful(await call("browser_tabs", { browser_id: browserA }))
      .find((tab) => tab.active).id).toBe(activeA);

    const snapshotA = successful(await call("browser_snapshot", { browser_id: browserA }));
    const snapshotB = successful(await call("browser_snapshot", { browser_id: browserB }));
    expect(snapshotA.title).toBe("Chrome Bridge E2E");
    expect(snapshotB.title).toBe("Chrome Bridge E2E");
    expectStatus(snapshotA, "Ready");
    expectStatus(snapshotB, "Ready");
    const refA = buttonRef(snapshotA);
    const refB = buttonRef(snapshotB);

    const tabsAfterSelectA = successful(await call("browser_tabs", { browser_id: browserA }));
    const tabsAfterSelectB = successful(await call("browser_tabs", { browser_id: browserB }));
    expect(tabsAfterSelectA.find((tab) => tab.active).id).toBe(activeA);
    expect(tabsAfterSelectB.find((tab) => tab.active).id).toBe(activeB);
    expect(tabsAfterSelectA.find((tab) => tab.targeted).id).toBe(openedA.id);
    expect(tabsAfterSelectB.find((tab) => tab.targeted).id).toBe(openedB.id);

    const landscapeInputDelay = await measureInputDelay(profileA, openedA.id);
    const portraitInputDelay = await measureInputDelay(profileB, openedB.id);
    verifyInputDelay(
      landscapeInputDelay,
      { width: 1_920, height: 1_080 },
      "landscape cold",
    );
    verifyInputDelay(
      portraitInputDelay,
      { width: 1_080, height: 1_920 },
      "portrait cold",
    );
    const recording = await recordFixture(
      call,
      pageA,
      browserA,
      "recording-production-landscape.webm",
    );
    await verifyRecording(
      profileA,
      recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1.5,
      "landscape",
    );
    const portraitRecording = await recordFixture(
      call,
      pageB,
      browserB,
      "recording-production-portrait.webm",
    );
    await verifyRecording(
      profileB,
      portraitRecording,
      { width: 1_080, height: 1_920 },
      browserB,
      1.5,
      "portrait",
    );
    const downloadsBeforeInvalid = await profileA.worker.evaluate(async () =>
      (await chrome.downloads.search({})).length,
    );
    const unsafeRecording = await call("browser_record_video", {
      browser_id: browserA,
      filename: "../escape.webm",
      duration: 0.5,
    });
    expect(unsafeRecording.isError).toBe(true);
    expect(toolText(unsafeRecording)).toContain("filename");
    expect(await profileA.worker.evaluate(async () =>
      (await chrome.downloads.search({})).length,
    )).toBe(downloadsBeforeInvalid);
    expect(successful(await call("browser_tabs", { browser_id: browserA }))
      .find((tab) => tab.active).id).toBe(activeA);
    expect(successful(await call("browser_tabs", { browser_id: browserB }))
      .find((tab) => tab.active).id).toBe(activeB);
    const postRecordingScreenshot = await call("browser_screenshot", {
      browser_id: browserA,
    });
    expect(postRecordingScreenshot.isError, toolText(postRecordingScreenshot))
      .not.toBe(true);

    const recordedClick = successful(await call("browser_click", {
      browser_id: browserA,
      element: "Update button",
      ref: refA,
      video_filename: "recorded-click.webm",
    }));
    const clickedA = recordedClick.operation;
    expectStatus(clickedA, "Updated A");
    await verifyRecording(
      profileA,
      recordedClick.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded click",
    );
    const recordedHover = successful(await call("browser_hover", {
      browser_id: browserA,
      element: "Hover target button",
      ref: refFor(clickedA, /button "Hover target"[^\n]*\[ref=([^\]]+)\]/),
      video_filename: "recorded-hover.webm",
    }));
    const hoveredA = recordedHover.operation;
    expect(hoveredA.snapshot).toContain("Hover: completed A");
    await verifyRecording(
      profileA,
      recordedHover.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded hover",
    );
    const recordedType = successful(await call("browser_type", {
      browser_id: browserA,
      element: "Name field",
      ref: refFor(hoveredA, /textbox "Name"[^\n]*\[ref=([^\]]+)\]/),
      text: "Alice",
      submit: false,
      video_filename: "recorded-type.webm",
    }));
    const typedA = recordedType.operation;
    expect(typedA.snapshot).toContain("Alice");
    await verifyRecording(
      profileA,
      recordedType.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded type",
    );
    const recordedSelect = successful(await call("browser_select_option", {
      browser_id: browserA,
      element: "Color select",
      ref: refFor(typedA, /combobox "Color"[^\n]*\[ref=([^\]]+)\]/),
      values: ["blue"],
      video_filename: "recorded-select.webm",
    }));
    const selectedA = recordedSelect.operation;
    expect(selectedA.snapshot).toContain("Selected: blue");
    await verifyRecording(
      profileA,
      recordedSelect.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded select",
    );
    const recordedKey = successful(await call("browser_press_key", {
      browser_id: browserA,
      key: "Enter",
      video_filename: "recorded-key.webm",
    }));
    expect(recordedKey.operation).toBe("Pressed key Enter");
    await verifyRecording(
      profileA,
      recordedKey.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded key",
    );
    const afterKeyA = successful(await call("browser_snapshot", {
      browser_id: browserA,
    }));
    expect(afterKeyA.snapshot).toContain("Key: Enter");
    const recordedDrag = successful(await call("browser_drag", {
      browser_id: browserA,
      startElement: "Movable card",
      startRef: refFor(afterKeyA, /button "Movable card"[^\n]*\[ref=([^\]]+)\]/),
      endElement: "Drop zone",
      endRef: refFor(afterKeyA, /region "Drop zone"[^\n]*\[ref=([^\]]+)\]/),
      video_filename: "recorded-drag.webm",
    }));
    const draggedA = recordedDrag.operation;
    expect(draggedA.snapshot).toContain("Drop: completed A");
    await verifyRecording(
      profileA,
      recordedDrag.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded drag",
    );

    const targetChangeTab = successful(await call("browser_tab_open", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/b`,
      active: false,
    }));
    const downloadsBeforeTargetChange = await profileA.worker.evaluate(async () =>
      (await chrome.downloads.search({})).length,
    );
    const interruptedKey = call("browser_press_key", {
      browser_id: browserA,
      key: "Escape",
      video_filename: "target-changed-key.webm",
    });
    await expect.poll(() => pageA.title()).toBe("● Chrome Bridge E2E");
    // Allow startup and its first frame to complete, then change only the routing target
    // during pre-roll. The key must not run on either tab; the original recording remains
    // a diagnostic artifact and its command-scoped debugger must still be released.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await profileA.worker.evaluate(async ({ tabId }) => {
      await chrome.storage.session.set({ targetTabId: tabId });
      await chrome.storage.session.remove("latestSnapshot");
    }, { tabId: targetChangeTab.id });
    const targetChangedResult = await interruptedKey;
    expect(targetChangedResult.isError).toBe(true);
    expect(toolText(targetChangedResult)).toContain(
      "Target tab changed while the page operation was waiting to run",
    );
    expect(toolText(targetChangedResult)).toContain("Recording saved:");
    expect(await pageA.textContent("body")).toContain("Key: Enter");
    expect(successful(await call("browser_tabs", { browser_id: browserB }))
      .find((tab) => tab.targeted).id).toBe(openedB.id);
    const targetChangeDownloads = await profileA.worker.evaluate(async () => ({
      count: (await chrome.downloads.search({})).length,
      latest: (await chrome.downloads.search({
        state: "complete",
        orderBy: ["-startTime"],
        limit: 1,
      })).map((item) => ({ filename: item.filename, id: item.id }))[0],
    }));
    expect(targetChangeDownloads.count).toBe(downloadsBeforeTargetChange + 1);
    const diagnosticDownload = targetChangeDownloads.latest;
    const diagnosticWebm = await readFile(diagnosticDownload.filename);
    expect([...diagnosticWebm.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    await removeProbeDownload(profileA, diagnosticDownload.id);
    expect((await call("browser_screenshot", { browser_id: browserA })).isError)
      .not.toBe(true);
    successful(await call("browser_tab_select", {
      browser_id: browserA,
      tab_id: openedA.id,
    }));
    expect(successful(await call("browser_tab_close", {
      browser_id: browserA,
      tab_id: targetChangeTab.id,
    }))).toMatchObject({ closed: true, tabId: targetChangeTab.id });
    await expect.poll(() => pageA.title()).toBe("◉ Chrome Bridge E2E");
    const afterTargetChangeA = successful(await call("browser_snapshot", {
      browser_id: browserA,
    }));
    expect(afterTargetChangeA.snapshot).toContain("Drop: completed A");

    const recordedUpload = successful(await call("browser_upload_file", {
      browser_id: browserA,
      element: "Choose files button",
      ref: refFor(
        afterTargetChangeA,
        /button "Choose files"[^\n]*\[ref=([^\]]+)\]/,
      ),
      paths: uploadPaths,
      video_filename: "recorded-upload.webm",
    }));
    const uploadedA = recordedUpload.operation;
    expect(uploadedA.snapshot).toContain("Files: upload-one.txt, upload-two.txt");
    expect(uploadedA.snapshot).toContain("Processing: pending");
    await verifyRecording(
      profileA,
      recordedUpload.recording,
      { width: 1_920, height: 1_080 },
      browserA,
      1,
      "recorded upload",
    );
    await call("browser_wait", { browser_id: browserA, time: 6 });
    const processedUploadA = successful(await call("browser_snapshot", {
      browser_id: browserA,
    }));
    expect(processedUploadA.snapshot).toContain("Processing: complete");
    const singleUpload = await call("browser_upload_file", {
      browser_id: browserA,
      element: "Choose one file button",
      ref: refFor(processedUploadA, /button "Choose one file"[^\n]*\[ref=([^\]]+)\]/),
      paths: uploadPaths,
      video_filename: "rejected-recorded-upload.webm",
    });
    expect(singleUpload.isError).toBe(true);
    expect(toolText(singleUpload)).toContain("accepts only one file");
    expect(toolText(singleUpload)).toContain("Recording saved:");
    const rejectedUploadDownload = await profileA.worker.evaluate(async () =>
      (await chrome.downloads.search({
        state: "complete",
        orderBy: ["-startTime"],
        limit: 1,
      })).map((item) => ({ filename: item.filename, id: item.id }))[0],
    );
    const rejectedUploadWebm = await readFile(rejectedUploadDownload.filename);
    expect([...rejectedUploadWebm.subarray(0, 4)])
      .toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    await removeProbeDownload(profileA, rejectedUploadDownload.id);
    expect(await pageA.evaluate(() => {
      const host = document.querySelector("#chrome-bridge-virtual-cursor");
      return Boolean(host?.shadowRoot?.querySelector("svg.cursor"));
    })).toBe(true);

    const uploadTargetChangeTab = successful(await call("browser_tab_open", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/b`,
      active: false,
    }));
    const downloadsBeforeUploadTargetChange = await profileA.worker.evaluate(async () =>
      (await chrome.downloads.search({})).length,
    );
    const targetChangedUpload = call("browser_upload_file", {
      browser_id: browserA,
      element: "Hover target button",
      ref: refFor(
        processedUploadA,
        /button "Hover target"[^\n]*\[ref=([^\]]+)\]/,
      ),
      paths: [uploadPaths[0]],
      video_filename: "target-changed-upload.webm",
    });
    await expect.poll(() => profileA.worker.evaluate(async ({ tabId }) =>
      (await chrome.debugger.getTargets()).some(
        (target) => target.tabId === tabId && target.attached,
      ),
    { tabId: openedA.id })).toBe(true);
    // Cross first-frame startup and pre-roll so interception and the chooser listener are
    // active before routing changes to another tab in the same Chrome profile.
    await new Promise((resolve) => setTimeout(resolve, 750));
    await profileA.worker.evaluate(async ({ tabId }) => {
      await chrome.storage.session.set({ targetTabId: tabId });
      await chrome.storage.session.remove("latestSnapshot");
    }, { tabId: uploadTargetChangeTab.id });
    const targetChangedUploadResult = await targetChangedUpload;
    expect(targetChangedUploadResult.isError).toBe(true);
    expect(toolText(targetChangedUploadResult)).toContain(
      "Operation outcome unknown:",
    );
    expect(toolText(targetChangedUploadResult)).toContain("Recording saved:");
    const uploadTargetChangeDownloads = await profileA.worker.evaluate(async () => ({
      count: (await chrome.downloads.search({})).length,
      latest: (await chrome.downloads.search({
        state: "complete",
        orderBy: ["-startTime"],
        limit: 1,
      })).map((item) => ({ filename: item.filename, id: item.id }))[0],
    }));
    expect(uploadTargetChangeDownloads.count)
      .toBe(downloadsBeforeUploadTargetChange + 1);
    const targetChangedUploadWebm = await readFile(
      uploadTargetChangeDownloads.latest.filename,
    );
    expect([...targetChangedUploadWebm.subarray(0, 4)])
      .toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    await removeProbeDownload(profileA, uploadTargetChangeDownloads.latest.id);
    expect((await call("browser_screenshot", { browser_id: browserA })).isError)
      .not.toBe(true);
    successful(await call("browser_tab_select", {
      browser_id: browserA,
      tab_id: openedA.id,
    }));
    expect(successful(await call("browser_tab_close", {
      browser_id: browserA,
      tab_id: uploadTargetChangeTab.id,
    }))).toMatchObject({ closed: true, tabId: uploadTargetChangeTab.id });

    const screenshotAStartedAt = performance.now();
    const screenshotA = await call("browser_screenshot", { browser_id: browserA });
    const landscapeScreenshot = {
      ...pngMetrics(screenshotA),
      elapsedMs: Math.round(performance.now() - screenshotAStartedAt),
    };
    expect([landscapeScreenshot.width, landscapeScreenshot.height])
      .toEqual([1_920, 1_080]);
    const screenshotBStartedAt = performance.now();
    const screenshotB = await call("browser_screenshot", { browser_id: browserB });
    const portraitScreenshot = {
      ...pngMetrics(screenshotB),
      elapsedMs: Math.round(performance.now() - screenshotBStartedAt),
    };
    expect([portraitScreenshot.width, portraitScreenshot.height])
      .toEqual([1_080, 1_920]);
    console.info("landscape screenshot metrics", landscapeScreenshot);
    console.info("portrait screenshot metrics", portraitScreenshot);
    expect(await pageA.locator("#chrome-bridge-agent-indicator").count()).toBe(0);

    const replacementA = successful(await call("browser_tab_open", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/b`,
      active: false,
    }));
    successful(await call("browser_tab_select", {
      browser_id: browserA,
      tab_id: replacementA.id,
    }));
    await expect.poll(() => pageA.title()).toBe("Chrome Bridge E2E");
    expect(await pageA.evaluate(() => ({
      indicator: Boolean(document.querySelector("#chrome-bridge-agent-indicator")),
      cursor: Boolean(document.querySelector("#chrome-bridge-virtual-cursor")),
    }))).toEqual({ indicator: false, cursor: false });
    expect(successful(await call("browser_tab_close", {
      browser_id: browserA,
      tab_id: replacementA.id,
    }))).toMatchObject({ closed: true, tabId: replacementA.id });
    const freshB = successful(await call("browser_snapshot", { browser_id: browserB }));
    expectStatus(freshB, "Ready");

    const staleB = await call("browser_click", {
      browser_id: browserB,
      element: "Update button",
      ref: refB,
    });
    expect(staleB.isError).toBe(true);
    expect(toolText(staleB)).toMatch(/stale/i);
    await expect.poll(() => pageB.title()).toBe("◉ Chrome Bridge E2E");
    const clickedB = successful(await call("browser_click", {
      browser_id: browserB,
      element: "Update button",
      ref: buttonRef(freshB),
    }));
    expectStatus(clickedB, "Updated B");

    await profileA.close();
    await waitFor(instances, (items) => items.length === 1 && items[0].browserId === browserB, "profile A disconnect");
    const bWhileAStopped = successful(await call("browser_snapshot", { browser_id: browserB }));
    expectStatus(bWhileAStopped, "Updated B");

    profileA = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("a"),
      name: "profile-a-restarted",
      viewport: { width: 1_920, height: 1_080 },
    });
    profiles.push(profileA);
    const reconnected = await waitFor(instances, (items) => items.length === 2, "profile A reconnect");
    expect(new Set(reconnected.map((item) => item.browserId))).toEqual(new Set([browserA, browserB]));
    expectStatus(successful(await call("browser_snapshot", { browser_id: browserB })), "Updated B");

    const closingRecordedTab = successful(await call("browser_tab_open", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
      active: false,
    }));
    successful(await call("browser_tab_select", {
      browser_id: browserA,
      tab_id: closingRecordedTab.id,
    }));
    const closingUploadSnapshot = successful(await call("browser_snapshot", {
      browser_id: browserA,
    }));
    const downloadsBeforeTabClose = await profileA.worker.evaluate(async () =>
      (await chrome.downloads.search({})).length,
    );
    const tabClosingUpload = call("browser_upload_file", {
      browser_id: browserA,
      element: "Hover target button",
      ref: refFor(
        closingUploadSnapshot,
        /button "Hover target"[^\n]*\[ref=([^\]]+)\]/,
      ),
      paths: [uploadPaths[0]],
      video_filename: "tab-closed-upload.webm",
    });
    await expect.poll(() => profileA.worker.evaluate(async ({ tabId }) =>
      (await chrome.debugger.getTargets()).some(
        (target) => target.tabId === tabId && target.attached,
      ),
    { tabId: closingRecordedTab.id })).toBe(true);
    // Cross first-frame startup and pre-roll so file-chooser interception is active when
    // the target closes. Cleanup may save a diagnostic or report a secondary capture
    // failure, but it must never leave a partial download or a selected dead target.
    await new Promise((resolve) => setTimeout(resolve, 750));
    await profileA.worker.evaluate(
      async ({ tabId }) => chrome.tabs.remove(tabId),
      { tabId: closingRecordedTab.id },
    );
    const tabClosedResult = await tabClosingUpload;
    expect(tabClosedResult.isError).toBe(true);
    expect(toolText(tabClosedResult)).toContain(
      "Operation outcome unknown:",
    );
    expect(toolText(tabClosedResult)).toContain(
      "Inspect current page state before retrying.",
    );
    const tabCloseDownloads = await profileA.worker.evaluate(async () => ({
      count: (await chrome.downloads.search({})).length,
      latest: (await chrome.downloads.search({
        state: "complete",
        orderBy: ["-startTime"],
        limit: 1,
      })).map((item) => ({ filename: item.filename, id: item.id }))[0],
    }));
    if (toolText(tabClosedResult).includes("Recording saved:")) {
      expect(tabCloseDownloads.count).toBe(downloadsBeforeTabClose + 1);
      const tabCloseDiagnostic = tabCloseDownloads.latest;
      const tabCloseWebm = await readFile(tabCloseDiagnostic.filename);
      expect([...tabCloseWebm.subarray(0, 4)])
        .toEqual([0x1a, 0x45, 0xdf, 0xa3]);
      await removeProbeDownload(profileA, tabCloseDiagnostic.id);
    } else {
      expect(toolText(tabClosedResult)).toContain("Recording also failed:");
      expect(tabCloseDownloads.count).toBe(downloadsBeforeTabClose);
    }
    expect(successful(await call("browser_tabs", { browser_id: browserA })))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ targeted: true })]));
    expect(successful(await call("browser_tabs", { browser_id: browserB })))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: openedB.id })]));

    const postCloseFixtureA = successful(await call("browser_tab_open", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
      active: false,
    }));
    successful(await call("browser_tab_select", {
      browser_id: browserA,
      tab_id: postCloseFixtureA.id,
    }));
    expect((await call("browser_screenshot", { browser_id: browserA })).isError)
      .not.toBe(true);
    expect(successful(await call("browser_tab_close", {
      browser_id: browserA,
      tab_id: postCloseFixtureA.id,
    }))).toMatchObject({ closed: true, tabId: postCloseFixtureA.id });

    const interruptedTab = successful(await call("browser_tab_open", {
      browser_id: browserB,
      url: `${fixture.baseUrl}/a`,
      active: false,
    }));
    successful(await call("browser_tab_select", {
      browser_id: browserB,
      tab_id: interruptedTab.id,
    }));
    const interruptedUploadSnapshot = successful(await call("browser_snapshot", {
      browser_id: browserB,
    }));
    const downloadsBeforeInterruption = await profileB.worker.evaluate(async () =>
      (await chrome.downloads.search({})).length,
    );
    const interruptedUpload = call("browser_upload_file", {
      browser_id: browserB,
      element: "Hover target button",
      ref: refFor(
        interruptedUploadSnapshot,
        /button "Hover target"[^\n]*\[ref=([^\]]+)\]/,
      ),
      paths: [uploadPaths[0]],
      video_filename: "externally-detached-upload.webm",
    });
    await expect.poll(() => profileB.worker.evaluate(async ({ tabId }) =>
      (await chrome.debugger.getTargets()).some(
        (target) => target.tabId === tabId && target.attached,
      ),
    { tabId: interruptedTab.id })).toBe(true);
    // Detach after first-frame startup and pre-roll while the chooser listener and
    // interception are active. Detach itself clears Chrome's interception state.
    await new Promise((resolve) => setTimeout(resolve, 750));
    await profileB.worker.evaluate(async ({ tabId }) => {
      const target = (await chrome.debugger.getTargets()).find(
        (candidate) => candidate.tabId === tabId && candidate.attached,
      );
      if (!target) throw new Error("Recorded upload debugger target is not attached");
      await chrome.debugger.detach({ targetId: target.id });
    }, { tabId: interruptedTab.id });
    const interruptedResult = await interruptedUpload;
    expect(interruptedResult.isError).toBe(true);
    expect(toolText(interruptedResult)).toContain(
      "Debugger is not attached to the target",
    );
    expect(toolText(interruptedResult)).toContain(
      "Recording also failed:",
    );
    expect(await profileB.worker.evaluate(async () =>
      (await chrome.downloads.search({})).length,
    )).toBe(downloadsBeforeInterruption);
    expect((await call("browser_screenshot", { browser_id: browserB })).isError)
      .not.toBe(true);
    expect(successful(await call("browser_tab_close", {
      browser_id: browserB,
      tab_id: interruptedTab.id,
    }))).toMatchObject({ closed: true, tabId: interruptedTab.id });
    successful(await call("browser_tab_select", {
      browser_id: browserB,
      tab_id: openedB.id,
    }));
    expect(successful(await call("browser_tab_close", {
      browser_id: browserB,
      tab_id: openedB.id,
    }))).toMatchObject({ closed: true, tabId: openedB.id, browserId: browserB });

    await profileB.close();
    await profileA.close();
    profileB = undefined;
    await waitFor(() => health(server), (value) => value.connectedBrowserCount === 0, "empty registry");
  } catch (error) {
    failure = error;
  } finally {
    if (failure) {
      for (const profile of profiles) {
        if (!profile.context.pages().length) continue;
        for (const [index, page] of profile.context.pages().entries()) {
          try {
            await page.screenshot({ path: testInfo.outputPath(`${profile.name}-${index}.png`) });
          } catch {
            // A browser that already crashed has no screenshot to preserve.
          }
        }
      }
    }
    for (const profile of profiles.toReversed()) {
      try {
        await profile.close(failure ? testInfo.outputPath(`${profile.name}-trace.zip`) : undefined);
      } catch (error) {
        failure ??= error;
      }
    }
    if (client) await client.close().catch((error) => { failure ??= error; });
    if (fixture) await fixture.close().catch((error) => { failure ??= error; });
    if (server) await server.close().catch((error) => { failure ??= error; });
    if (failure) {
      await testInfo.attach("mcp-transcript", {
        body: Buffer.from(JSON.stringify(transcript, null, 2)),
        contentType: "application/json",
      });
      if (server) {
        await testInfo.attach("server-log", { body: Buffer.from(server.logs()), contentType: "text/plain" });
      }
      for (const profile of profiles) {
        if (profile.logs.length) {
          await testInfo.attach(`${profile.name}-log`, {
            body: Buffer.from(profile.logs.join("\n")),
            contentType: "text/plain",
          });
        }
      }
    }
    if (artifact) await artifact.close().catch((error) => { failure ??= error; });
  }
  if (failure) throw failure;
});
