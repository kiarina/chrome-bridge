import {
  clearSnapshotState,
  ariaTextContains,
  generateSnapshot,
  resolveAriaRef,
  waitForAriaText,
} from "../src/snapshot";
import {
  moveVirtualCursor,
  pressVirtualCursor,
  prepareClickTarget,
  prepareDragTargets,
  prepareSelectOptions,
  prepareTypeTarget,
  removeVirtualCursor,
  selectOptions,
  setVirtualCursorPressed,
  waitForStableDOM,
} from "../src/interaction";
import {
  disposeAgentUi,
  getAgentUiState,
  getLogicalDocumentTitle,
  setAgentUiState,
} from "../src/agent-ui";
import { resizePng } from "../src/image";

(globalThis as Record<string, unknown>).chromeBridgeSnapshotTest = {
  clearSnapshotState,
  ariaTextContains,
  generateSnapshot,
  resolveAriaRef,
  prepareClickTarget,
  prepareDragTargets,
  prepareTypeTarget,
  prepareSelectOptions,
  selectOptions,
  waitForStableDOM,
  waitForAriaText,
  moveVirtualCursor,
  pressVirtualCursor,
  removeVirtualCursor,
  setVirtualCursorPressed,
  setAgentUiState,
  getAgentUiState,
  getLogicalDocumentTitle,
  disposeAgentUi,
  resizePng,
};
