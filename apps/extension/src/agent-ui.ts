export type AgentUiState = "off" | "target" | "operating";

const LEGACY_INDICATOR_HOST_ID = "chrome-bridge-agent-indicator";
const TITLE_PREFIXES: Record<Exclude<AgentUiState, "off">, string> = {
  target: "◉ ",
  operating: "● ",
};

let currentState: AgentUiState = "off";
let logicalTitle = document.title;
let appliedTitle: string | null = null;
let applyingTitle = false;
let titleObserver: MutationObserver | undefined;

export function setAgentUiState(state: AgentUiState): void {
  if (!isAgentUiState(state)) {
    throw new Error(`Invalid agent UI state: ${String(state)}`);
  }
  captureExternalTitleChange();
  removeLegacyIndicator();
  currentState = state;
  applyTitle();
}

export function getAgentUiState(): AgentUiState {
  return currentState;
}

export function getLogicalDocumentTitle(): string {
  captureExternalTitleChange();
  return logicalTitle;
}

export function disposeAgentUi(): void {
  captureExternalTitleChange();
  removeLegacyIndicator();
  currentState = "off";
  applyTitle();
  titleObserver?.disconnect();
  titleObserver = undefined;
}

function removeLegacyIndicator(): void {
  document.getElementById(LEGACY_INDICATOR_HOST_ID)?.remove();
}

function isAgentUiState(value: unknown): value is AgentUiState {
  return value === "off" || value === "target" || value === "operating";
}

function ensureTitleObserver(): void {
  if (titleObserver) return;
  titleObserver = new MutationObserver(() => {
    if (applyingTitle) return;
    captureExternalTitleChange();
    applyTitle();
  });
  titleObserver.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

function captureExternalTitleChange(): void {
  const currentTitle = document.title;
  if (appliedTitle === null || currentTitle !== appliedTitle) {
    logicalTitle = currentTitle;
    appliedTitle = null;
  }
}

function applyTitle(): void {
  ensureTitleObserver();
  const nextTitle =
    currentState === "off"
      ? logicalTitle
      : `${TITLE_PREFIXES[currentState]}${logicalTitle}`;
  if (document.title === nextTitle) {
    appliedTitle = currentState === "off" ? null : nextTitle;
    return;
  }
  applyingTitle = true;
  document.title = nextTitle;
  appliedTitle = currentState === "off" ? null : nextTitle;
  queueMicrotask(() => {
    applyingTitle = false;
  });
}
