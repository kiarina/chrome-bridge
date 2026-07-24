import { expect, test } from "@playwright/test";

import {
  connectMcp,
  launchProfile,
  prepareExtensionArtifact,
  reserveLoopbackPort,
  startFixtureServer,
  startServer,
  toolCaller,
  toolText,
  toolValue,
  waitFor,
} from "./harness.js";

function successful(result) {
  expect(result.isError, toolText(result)).not.toBe(true);
  return toolValue(result);
}

function refFor(snapshot, label) {
  const match = snapshot.snapshot.match(
    new RegExp(`button "${label}"[^\\n]*\\[ref=([^\\]]+)\\]`),
  );
  expect(match, snapshot.snapshot).not.toBeNull();
  return match[1];
}

test("promotes an operation debugger session into dominant dialog PageState", async () => {
  const port = await reserveLoopbackPort();
  const server = await startServer({ port });
  const fixture = await startFixtureServer();
  const artifact = await prepareExtensionArtifact(
    `ws://127.0.0.1:${port}/extension`,
  );
  let profile;
  let client;
  let fixturePage;
  const playwrightDialogs = [];
  try {
    profile = await launchProfile({
      artifactDir: artifact.artifactDir,
      userDataDir: artifact.profileDir("dialogs"),
      name: "dialogs-profile",
      viewport: { width: 1_280, height: 720 },
    });
    client = await connectMcp(server.mcpUrl);
    const transcript = [];
    const call = toolCaller(client, transcript);
    const browser = await waitFor(
      async () => successful(await call("browser_instances"))[0],
      Boolean,
      "dialog browser instance",
    );
    const url = `${fixture.baseUrl}/a`;
    const tab = successful(
      await call("browser_tab_open", {
        url,
        active: false,
        browser_id: browser.browserId,
      }),
    );
    fixturePage = await waitFor(
      () => Promise.resolve(profile.context.pages().find((page) => page.url() === url)),
      Boolean,
      "dialog fixture page",
    );
    fixturePage.on("dialog", (dialog) => {
      // Keep the dialog open for chrome-bridge's retained CDP session to answer.
      playwrightDialogs.push(dialog);
    });
    successful(
      await call("browser_tab_select", {
        tab_id: tab.id,
        browser_id: browser.browserId,
      }),
    );

    const initial = successful(
      await call("browser_snapshot", { browser_id: browser.browserId }),
    );
    const clickResult = await call("browser_click", {
        element: "Open alert",
        ref: refFor(initial, "Open alert"),
        browser_id: browser.browserId,
      });
    const opened = successful(clickResult);
    expect(opened).toMatchObject({
      pageState: "browser-dialog",
      url,
      dialog: {
        type: "alert",
        message: "Chrome Bridge dialog probe",
        defaultPrompt: "",
        actions: ["accept"],
      },
      browserId: browser.browserId,
    });
    expect(opened.dialog.ref).toBe(`s${opened.generation}d1`);

    expect(
      successful(
        await call("browser_snapshot", { browser_id: browser.browserId }),
      ),
    ).toEqual(opened);
    const blocked = await call("browser_press_key", {
      key: "Enter",
      browser_id: browser.browserId,
    });
    expect(blocked.isError).toBe(true);
    expect(toolText(blocked)).toContain("browser_dialog_respond");

    const resumed = successful(
      await call("browser_dialog_respond", {
        dialog_ref: opened.dialog.ref,
        action: "accept",
        browser_id: browser.browserId,
      }),
    );
    expect(resumed.pageState).toBeUndefined();
    expect(resumed.snapshot).toContain("Isolated fixture");
    expect(resumed.generation).toBeGreaterThan(opened.generation);

    const stale = await call("browser_dialog_respond", {
      dialog_ref: opened.dialog.ref,
      action: "accept",
      browser_id: browser.browserId,
    });
    expect(stale.isError).toBe(true);
    expect(toolText(stale)).toContain("No browser dialog is open");

    const confirmState = successful(
      await call("browser_click", {
        element: "Open confirm",
        ref: refFor(resumed, "Open confirm"),
        browser_id: browser.browserId,
      }),
    );
    expect(confirmState.dialog).toMatchObject({
      type: "confirm",
      message: "Confirm probe",
      actions: ["accept", "dismiss"],
    });
    const invalidPromptText = await call("browser_dialog_respond", {
      dialog_ref: confirmState.dialog.ref,
      action: "dismiss",
      prompt_text: "not valid",
      browser_id: browser.browserId,
    });
    expect(invalidPromptText.isError).toBe(true);
    expect(toolText(invalidPromptText)).toContain("prompt_text");
    const afterConfirm = successful(
      await call("browser_dialog_respond", {
        dialog_ref: confirmState.dialog.ref,
        action: "dismiss",
        browser_id: browser.browserId,
      }),
    );
    expect(afterConfirm.snapshot).toContain("Confirm result: false");

    const promptState = successful(
      await call("browser_click", {
        element: "Open prompt",
        ref: refFor(afterConfirm, "Open prompt"),
        browser_id: browser.browserId,
      }),
    );
    expect(promptState.dialog).toMatchObject({
      type: "prompt",
      message: "Prompt probe",
      defaultPrompt: "default",
    });
    const afterPrompt = successful(
      await call("browser_dialog_respond", {
        dialog_ref: promptState.dialog.ref,
        action: "accept",
        prompt_text: "LLM response",
        browser_id: browser.browserId,
      }),
    );
    expect(afterPrompt.snapshot).toContain("Prompt result: LLM response");

    const firstChained = successful(
      await call("browser_click", {
        element: "Open chained dialogs",
        ref: refFor(afterPrompt, "Open chained dialogs"),
        browser_id: browser.browserId,
      }),
    );
    expect(firstChained.dialog.message).toBe("First chained dialog");
    const secondChained = successful(
      await call("browser_dialog_respond", {
        dialog_ref: firstChained.dialog.ref,
        action: "accept",
        browser_id: browser.browserId,
      }),
    );
    expect(secondChained).toMatchObject({
      pageState: "browser-dialog",
      dialog: { type: "prompt", message: "Second chained dialog" },
    });
    expect(secondChained.generation).toBeGreaterThan(firstChained.generation);
    const afterChained = successful(
      await call("browser_dialog_respond", {
        dialog_ref: secondChained.dialog.ref,
        action: "accept",
        prompt_text: "complete",
        browser_id: browser.browserId,
      }),
    );
    expect(afterChained.snapshot).toContain("Chained result: complete");

    const armed = successful(
      await call("browser_click", {
        element: "Arm beforeunload",
        ref: refFor(afterChained, "Arm beforeunload"),
        browser_id: browser.browserId,
      }),
    );
    const beforeUnload = successful(
      await call("browser_navigate", {
        url: `${fixture.baseUrl}/b`,
        browser_id: browser.browserId,
      }),
    );
    expect(beforeUnload.dialog).toMatchObject({
      type: "beforeunload",
      actions: ["accept", "dismiss"],
    });
    expect(beforeUnload.generation).toBeGreaterThan(armed.generation);
    const afterLeave = successful(
      await call("browser_dialog_respond", {
        dialog_ref: beforeUnload.dialog.ref,
        action: "accept",
        browser_id: browser.browserId,
      }),
    );
    expect(afterLeave.url).toBe(`${fixture.baseUrl}/b`);
    expect(afterLeave.snapshot).toContain("Route: /b");

    const recordedDialog = successful(
      await call("browser_click", {
        element: "Open alert",
        ref: refFor(afterLeave, "Open alert"),
        video_filename: "dialog.webm",
        browser_id: browser.browserId,
      }),
    );
    const recordedResume = successful(
      await call("browser_dialog_respond", {
        dialog_ref: recordedDialog.dialog.ref,
        action: "accept",
        browser_id: browser.browserId,
      }),
    );
    expect(recordedResume.recording).toMatchObject({
      requestedFilename: "dialog.webm",
      filename: "chrome-bridge/dialog.webm",
      mimeType: "video/webm",
    });
    expect(recordedResume.recording.frameCount).toBeGreaterThan(0);
    const [dialogDownload] = await profile.worker.evaluate(() =>
      chrome.downloads.search({
        state: "complete",
        orderBy: ["-startTime"],
        limit: 1,
      }),
    );
    expect(dialogDownload).toBeTruthy();
    await profile.worker.evaluate(async (downloadId) => {
      await chrome.downloads.removeFile(downloadId);
      await chrome.downloads.erase({ id: downloadId });
    }, dialogDownload.id);
  } finally {
    await client?.close();
    await Promise.allSettled(
      playwrightDialogs.map((dialog) => dialog.dismiss()),
    );
    fixturePage?.removeAllListeners("dialog");
    try {
      await profile?.close();
    } catch (error) {
      if (!String(error).includes("Page.handleJavaScriptDialog): No dialog is showing")) {
        throw error;
      }
      // Playwright's dialog bookkeeping does not observe a response sent by the
      // extension-owned CDP session, although Chromium has already closed it.
    }
    await artifact.close();
    await fixture.close();
    await server.close();
  }
});
