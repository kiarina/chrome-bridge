import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  connectMcp,
  launchProfile,
  prepareExtensionArtifact,
  startFixtureServer,
  startServer,
  toolCaller,
  toolText,
  toolValue,
  waitFor,
} from "./harness.js";

async function health(server) {
  const response = await fetch(`${server.httpUrl}/health`);
  expect(response.ok).toBe(true);
  return response.json();
}

function successful(result) {
  expect(result.isError, toolText(result)).not.toBe(true);
  return toolValue(result);
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
    droppedFrameCount: 0,
    width: expectedSize.width,
    height: expectedSize.height,
    browserId: expectedBrowserId,
  });
  expect(recording.frameCount).toBeGreaterThanOrEqual(expectedDuration * 5);
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
    await expect.poll(() => profileA.worker.evaluate(async () => ({
      status: (await chrome.storage.local.get("connectionStatus")).connectionStatus?.status,
      title: await chrome.action.getTitle({}),
    }))).toEqual({ status: "connected", title: "Chrome Bridge — Connected" });
    for (const instance of connected) {
      expect(instance).toMatchObject({
        protocolVersion: 2,
        extensionVersion: "0.1.0",
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
    await expect.poll(() => pageA.evaluate(() =>
      document.querySelector("#chrome-bridge-agent-indicator")?.shadowRoot?.querySelector(".label")?.textContent,
    )).toBe("Agent target");

    const waitingA = call("browser_wait", { browser_id: browserA, time: 0.5 });
    await expect.poll(() => pageA.title()).toBe("● Chrome Bridge E2E");
    await expect.poll(() => pageA.evaluate(() =>
      document.querySelector("#chrome-bridge-agent-indicator")?.shadowRoot?.querySelector(".label")?.textContent,
    )).toBe("Agent operating");
    successful(await waitingA);
    await expect.poll(() => pageA.title()).toBe("◉ Chrome Bridge E2E");

    const snapshotA = successful(await call("browser_snapshot", { browser_id: browserA }));
    const snapshotB = successful(await call("browser_snapshot", { browser_id: browserB }));
    expect(snapshotA.title).toBe("Chrome Bridge E2E");
    expect(snapshotB.title).toBe("Chrome Bridge E2E");
    expectStatus(snapshotA, "Ready");
    expectStatus(snapshotB, "Ready");
    const refA = buttonRef(snapshotA);
    const refB = buttonRef(snapshotB);
    expect(refA).toBe(refB);

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
      10,
    );
    await verifyRecording(
      profileB,
      portraitRecording,
      { width: 1_080, height: 1_920 },
      browserB,
      10,
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

    const clickedA = successful(await call("browser_click", {
      browser_id: browserA,
      element: "Update button",
      ref: refA,
    }));
    expectStatus(clickedA, "Updated A");
    const typedA = successful(await call("browser_type", {
      browser_id: browserA,
      element: "Name field",
      ref: refFor(clickedA, /textbox "Name"[^\n]*\[ref=([^\]]+)\]/),
      text: "Alice",
      submit: false,
    }));
    expect(typedA.snapshot).toContain("Alice");
    const draggedA = successful(await call("browser_drag", {
      browser_id: browserA,
      startElement: "Movable card",
      startRef: refFor(typedA, /button "Movable card"[^\n]*\[ref=([^\]]+)\]/),
      endElement: "Drop zone",
      endRef: refFor(typedA, /region "Drop zone"[^\n]*\[ref=([^\]]+)\]/),
    }));
    expect(draggedA.snapshot).toContain("Drop: completed A");
    const uploadedA = successful(await call("browser_upload_file", {
      browser_id: browserA,
      element: "Choose files button",
      ref: refFor(draggedA, /button "Choose files"[^\n]*\[ref=([^\]]+)\]/),
      paths: uploadPaths,
    }));
    expect(uploadedA.snapshot).toContain("Files: upload-one.txt, upload-two.txt");
    expect(uploadedA.snapshot).toContain("Processing: pending");
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
    });
    expect(singleUpload.isError).toBe(true);
    expect(toolText(singleUpload)).toContain("accepts only one file");
    expect(await pageA.evaluate(() => {
      const host = document.querySelector("#chrome-bridge-virtual-cursor");
      return Boolean(host?.shadowRoot?.querySelector("svg.cursor"));
    })).toBe(true);
    const screenshotA = await call("browser_screenshot", { browser_id: browserA });
    expect(screenshotA.isError, toolText(screenshotA)).not.toBe(true);
    expect(screenshotA.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", mimeType: "image/png" }),
    ]));
    await expect.poll(() => pageA.evaluate(() =>
      document.querySelector("#chrome-bridge-agent-indicator")?.style.visibility,
    )).toBe("visible");

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

    const restartedFixtureA = successful(await call("browser_tab_open", {
      browser_id: browserA,
      url: `${fixture.baseUrl}/a`,
      active: false,
    }));
    expect(successful(await call("browser_tab_close", {
      browser_id: browserA,
      tab_id: restartedFixtureA.id,
    }))).toMatchObject({ closed: true, tabId: restartedFixtureA.id, browserId: browserA });
    expect(successful(await call("browser_tabs", { browser_id: browserB })))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: openedB.id })]));
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
