import { clearSnapshotState, generateSnapshot } from "./snapshot";
import {
  moveVirtualCursor,
  performSelectOptions,
  prepareSelectOptions,
  prepareClickTarget,
  prepareDragTargets,
  prepareTypeTarget,
  pressVirtualCursor,
  removeVirtualCursor,
  setVirtualCursorPressed,
  waitForStableDOM,
} from "./interaction";
import { resizePng } from "./image";
import {
  type AgentUiState,
  getLogicalDocumentTitle,
  setAgentUiState,
} from "./agent-ui";

const RUNTIME_MARKER = "__chromeBridgeContentRuntimeV1";

type ContentMessage = {
  type?: string;
  generation?: number;
  ref?: string;
  startRef?: string;
  endRef?: string;
  x?: number;
  y?: number;
  values?: string[];
  data?: string;
  maxWidth?: number;
  maxHeight?: number;
  state?: AgentUiState;
  durationMs?: number;
  pressed?: boolean;
};

if (!(globalThis as Record<string, unknown>)[RUNTIME_MARKER]) {
  (globalThis as Record<string, unknown>)[RUNTIME_MARKER] = true;
  chrome.runtime.onMessage.addListener(
    (message: ContentMessage, _sender, sendResponse) => {
      if (message?.type === "chrome-bridge.content.ping") {
        sendResponse({ ok: true, version: 1 });
        return false;
      }
      if (message?.type === "chrome-bridge.snapshot.clear") {
        clearSnapshotState();
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === "chrome-bridge.snapshot.generate") {
        try {
          const result = generateSnapshot(message.generation!);
          sendResponse({
            ok: true,
            result: { ...result, title: getLogicalDocumentTitle() },
          });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
      if (message?.type === "chrome-bridge.click.prepare") {
        try {
          sendResponse({
            ok: true,
            result: prepareClickTarget(message.ref || ""),
          });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
      if (message?.type === "chrome-bridge.hover.prepare") {
        try {
          sendResponse({
            ok: true,
            result: prepareClickTarget(message.ref || ""),
          });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
      if (message?.type === "chrome-bridge.type.prepare") {
        try {
          sendResponse({
            ok: true,
            result: prepareTypeTarget(message.ref || ""),
          });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
      if (message?.type === "chrome-bridge.drag.prepare") {
        try {
          sendResponse({
            ok: true,
            result: prepareDragTargets(
              message.startRef || "",
              message.endRef || "",
            ),
          });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
      if (message?.type === "chrome-bridge.drag.cursor") {
        try {
          const result = moveVirtualCursor(
            { x: message.x ?? -1, y: message.y ?? -1 },
            message.durationMs,
          );
          sendResponse({ ok: true, result });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
      if (message?.type === "chrome-bridge.cursor.press") {
        pressVirtualCursor();
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === "chrome-bridge.cursor.pressed") {
        setVirtualCursorPressed(message.pressed === true);
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === "chrome-bridge.select.prepare") {
        try {
          sendResponse({
            ok: true,
            result: prepareSelectOptions(
              message.ref || "",
              message.values || [],
            ),
          });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
      if (message?.type === "chrome-bridge.select.perform") {
        try {
          sendResponse({
            ok: true,
            result: {
              values: performSelectOptions(
                message.ref || "",
                message.values || [],
              ),
            },
          });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
      if (message?.type === "chrome-bridge.ui.setState") {
        try {
          setAgentUiState(message.state || "off");
          if (message.state === "off") removeVirtualCursor();
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
      if (message?.type === "chrome-bridge.dom.waitForStable") {
        void waitForStableDOM().then(
          (result) => sendResponse({ ok: true, result }),
          (error) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
        );
        return true;
      }
      if (message?.type === "chrome-bridge.image.resize") {
        void resizePng(
          message.data || "",
          message.maxWidth || 0,
          message.maxHeight || 0,
        ).then(
          (result) => sendResponse({ ok: true, result }),
          (error) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
        );
        return true;
      }
      return false;
    },
  );

  void chrome.runtime
    .sendMessage({ type: "chrome-bridge.ui.getState" })
    .then((response) => {
      if (response?.ok && response.state) setAgentUiState(response.state);
    })
    .catch(() => {
      // The background can be restarting while a document initializes.
    });
}
