import { expect, test } from "@playwright/test";

import {
  launchProfile,
  prepareExtensionArtifact,
  reserveLoopbackPort,
  startFixtureServer,
  waitFor,
} from "./harness.js";

async function createFixtureTab(profile, url) {
  const tab = await profile.worker.evaluate(
    ({ targetUrl }) => chrome.tabs.create({ active: false, url: targetUrl }),
    { targetUrl: url },
  );
  const page = await waitFor(
    () => Promise.resolve(
      profile.context.pages().find((candidate) => candidate.url() === url),
    ),
    Boolean,
    `dialog fixture ${url}`,
  );
  await page.waitForLoadState("load");
  return { page, tabId: tab.id };
}

async function probe(profile, method, params) {
  return profile.worker.evaluate(
    ({ name, value }) => globalThis.__chromeBridgeDialogProbe[name](value),
    { name: method, value: params },
  );
}

test("measures JavaScript dialog lifecycle across debugger command boundaries", async () => {
  test.setTimeout(120_000);
  const profiles = [];
  let artifact;
  let fixture;
  let removeTab = true;
  let tabId;
  try {
    const port = await reserveLoopbackPort();
    artifact = await prepareExtensionArtifact(
      `ws://127.0.0.1:${port}/extension`,
    );
    fixture = await startFixtureServer();
    const profile = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("dialog"),
      name: "dialog-profile",
      viewport: { width: 1_280, height: 720 },
    });
    profiles.push(profile);

    const fixtureUrl = `${fixture.baseUrl}/a`;
    const created = await createFixtureTab(profile, fixtureUrl);
    tabId = created.tabId;
    const observedDialogs = [];
    created.page.on("dialog", (dialog) => {
      observedDialogs.push(dialog);
    });

    const clickStart = await probe(profile, "startClickDialog", { tabId });
    console.log("dialog probe stage: click opened");
    expect(clickStart).toMatchObject({
      attached: true,
      commandSettledAtReturn: false,
      dialog: {
        message: "Chrome Bridge dialog probe",
        type: "alert",
      },
      openings: 1,
    });
    expect(observedDialogs.at(-1).message())
      .toBe("Chrome Bridge dialog probe");
    expect(observedDialogs.at(-1).type()).toBe("alert");

    const clickEnd = await probe(profile, "resolveHeld", { accept: true });
    console.log("dialog probe stage: click resolved");
    expect(clickEnd).toMatchObject({
      closed: { result: true },
      closings: 1,
      command: { error: null, settled: true },
      handleError: null,
    });
    await created.page.locator("#arm-beforeunload").click();
    const beforeUnloadStart = await probe(profile, "startBeforeUnload", {
      tabId,
    });
    console.log("dialog probe stage: beforeunload opened");
    expect(beforeUnloadStart).toMatchObject({
      attached: true,
      dialog: { type: "beforeunload" },
      openings: 1,
    });
    const beforeUnloadEnd = await probe(profile, "resolveHeld", {
      accept: false,
    });
    console.log("dialog probe stage: beforeunload resolved");
    expect(beforeUnloadEnd).toMatchObject({
      closed: { result: false },
      closings: 1,
      handleError: null,
    });
    await expect(created.page.locator("[role=status]"))
      .toHaveText("Beforeunload armed");
    await created.page.evaluate(() => {
      globalThis.onbeforeunload = null;
    });

    const detachStart = await probe(profile, "startClickDialog", { tabId });
    console.log("dialog probe stage: detach dialog opened");
    expect(detachStart.dialog).toMatchObject({ type: "alert" });
    const detached = await probe(profile, "detachHeldWithoutResponse", {});
    console.log("dialog probe stage: detached without response");
    const afterDetachPending = await probe(profile, "beginAttachAttempt", {
      tabId,
    });
    console.log("dialog probe stage: reattach measured while dialog open");
    console.log("dialog lifecycle probe", JSON.stringify({
      afterDetachPending,
      beforeUnloadEnd,
      beforeUnloadStart,
      clickEnd,
      clickStart,
      detached,
    }));
    expect(afterDetachPending.attach).toMatchObject({
      error: null,
      settled: true,
    });
    expect(afterDetachPending.enable.settled).toBe(false);
    expect(afterDetachPending.openings).toEqual([]);
    removeTab = false;

  } finally {
    if (removeTab && tabId !== undefined && profiles[0]) {
      await profiles[0].worker.evaluate(async ({ targetTabId }) => {
        try {
          await chrome.tabs.remove(targetTabId);
        } catch {
          // The probe may already have closed its fixture tab.
        }
      }, { targetTabId: tabId });
    }
    await Promise.allSettled(profiles.map((profile) => profile.close()));
    await fixture?.close();
    await artifact?.close();
  }
});

test("measures a dialog opened while chrome.debugger is detached", async () => {
  test.setTimeout(60_000);
  const profiles = [];
  let artifact;
  let fixture;
  try {
    const port = await reserveLoopbackPort();
    artifact = await prepareExtensionArtifact(
      `ws://127.0.0.1:${port}/extension`,
    );
    fixture = await startFixtureServer();
    const profile = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("unattached-dialog"),
      name: "unattached-dialog-profile",
      viewport: { width: 1_280, height: 720 },
    });
    profiles.push(profile);
    const created = await createFixtureTab(profile, `${fixture.baseUrl}/a`);
    const dialogOpened = new Promise((resolve) => {
      created.page.once("dialog", resolve);
    });
    await created.page.evaluate(() => {
      setTimeout(
        () => globalThis.alert("Opened between debugger attachments"),
        0,
      );
    });
    await dialogOpened;

    const measured = await probe(profile, "beginAttachAttempt", {
      accept: false,
      tabId: created.tabId,
    });
    console.log("unattached dialog probe", JSON.stringify(measured));
    expect(measured.attach).toMatchObject({ error: null, settled: true });
  } finally {
    await Promise.allSettled(profiles.map((profile) => profile.close()));
    await fixture?.close();
    await artifact?.close();
  }
});

test("keeps a dialog monitor across worker calls", async () => {
  test.setTimeout(60_000);
  const profiles = [];
  let artifact;
  let fixture;
  let monitorStarted = false;
  try {
    const port = await reserveLoopbackPort();
    artifact = await prepareExtensionArtifact(
      `ws://127.0.0.1:${port}/extension`,
    );
    fixture = await startFixtureServer();
    const profile = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("dialog-monitor"),
      name: "dialog-monitor-profile",
      viewport: { width: 1_280, height: 720 },
    });
    profiles.push(profile);
    const created = await createFixtureTab(profile, `${fixture.baseUrl}/a`);
    const [activeBefore] = await profile.worker.evaluate(() =>
      chrome.tabs.query({ active: true, currentWindow: true }));
    const dialogOpened = new Promise((resolve) => {
      created.page.once("dialog", resolve);
    });

    await probe(profile, "startMonitor", { tabId: created.tabId });
    monitorStarted = true;
    await new Promise((resolve) => setTimeout(resolve, 35_000));
    const afterIdleWindow = await probe(profile, "monitorState", {});
    expect(afterIdleWindow).toMatchObject({ openings: [], closings: [] });
    await created.page.evaluate(() => {
      setTimeout(
        () => globalThis.alert("Observed by persistent monitor"),
        0,
      );
    });
    await dialogOpened;
    const opened = await waitFor(
      () => probe(profile, "monitorState", {}),
      (state) => state.openings.length === 1,
      "persistent dialog opening event",
    );
    expect(opened.openings[0]).toMatchObject({
      message: "Observed by persistent monitor",
      type: "alert",
    });

    const contentDuring = await probe(
      profile,
      "contentMessageDuringDialog",
      { tabId: created.tabId },
    );
    const accessibilityDuring = await probe(
      profile,
      "accessibilityDuringDialog",
      {},
    );
    const resolved = await probe(profile, "resolveMonitoredDialog", {
      accept: true,
    });
    expect(resolved.closings).toHaveLength(1);
    const contentAfter = await probe(
      profile,
      "contentMessageDuringDialog",
      { tabId: created.tabId },
    );

    const confirmDialog = new Promise((resolve) => {
      created.page.once("dialog", resolve);
    });
    const confirmTriggered = await probe(profile, "triggerMonitoredClick", {
      selector: "#confirm-dialog",
    });
    await confirmDialog;
    expect(confirmTriggered).toMatchObject({
      command: { settled: false },
      opening: { message: "Confirm probe", type: "confirm" },
    });
    const confirmResolved = await probe(
      profile,
      "resolveMonitoredDialog",
      { accept: false },
    );
    await expect(created.page.locator("[role=status]"))
      .toHaveText("Confirm result: false");

    const promptDialog = new Promise((resolve) => {
      created.page.once("dialog", resolve);
    });
    const promptTriggered = await probe(profile, "triggerMonitoredClick", {
      selector: "#prompt-dialog",
    });
    await promptDialog;
    expect(promptTriggered).toMatchObject({
      command: { settled: false },
      opening: {
        defaultPrompt: "default",
        message: "Prompt probe",
        type: "prompt",
      },
    });
    const promptResolved = await probe(
      profile,
      "resolveMonitoredDialog",
      { accept: true, promptText: "LLM response" },
    );
    await expect(created.page.locator("[role=status]"))
      .toHaveText("Prompt result: LLM response");

    const stopped = await probe(profile, "stopMonitor", {});
    monitorStarted = false;
    const [activeAfter] = await profile.worker.evaluate(() =>
      chrome.tabs.query({ active: true, currentWindow: true }));

    console.log("persistent dialog monitor probe", JSON.stringify({
      accessibilityDuring,
      afterIdleWindow,
      contentAfter,
      contentDuring,
      confirmResolved,
      confirmTriggered,
      opened,
      promptResolved,
      promptTriggered,
      resolved,
      stopped,
    }));
    expect(contentDuring.settled).toBe(false);
    expect(contentAfter).toMatchObject({ error: null, settled: true });
    expect(activeAfter.id).toBe(activeBefore.id);
    expect(activeAfter.id).not.toBe(created.tabId);
  } finally {
    if (monitorStarted && profiles[0]) {
      await probe(profiles[0], "stopMonitor", {}).catch(() => {});
    }
    await Promise.allSettled(profiles.map((profile) => profile.close()));
    await fixture?.close();
    await artifact?.close();
  }
});
