import {
  clearSnapshotState,
  generateSnapshot,
  resolveAriaRef,
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
  setIndicatorHiddenForCapture,
} from "../src/agent-ui";
import { resizePng } from "../src/image";

(globalThis as Record<string, unknown>).chromeBridgeSnapshotTest = {
  clearSnapshotState,
  generateSnapshot,
  resolveAriaRef,
  prepareClickTarget,
  prepareDragTargets,
  prepareTypeTarget,
  prepareSelectOptions,
  selectOptions,
  waitForStableDOM,
  moveVirtualCursor,
  pressVirtualCursor,
  removeVirtualCursor,
  setVirtualCursorPressed,
  setAgentUiState,
  getAgentUiState,
  getLogicalDocumentTitle,
  setIndicatorHiddenForCapture,
  disposeAgentUi,
  resizePng,
};
