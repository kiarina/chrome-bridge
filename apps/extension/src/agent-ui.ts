export type AgentUiState = "off" | "target" | "operating";

const LEGACY_INDICATOR_HOST_ID = "chrome-bridge-agent-indicator";
const TITLE_PREFIXES: Record<Exclude<AgentUiState, "off">, string> = {
  target: "◉ ",
  operating: "● ",
};
const RUNTIME_OWNERSHIP_ATTRIBUTE =
  "data-chrome-bridge-content-runtime-owner-v1";
const TITLE_OWNERSHIP_ATTRIBUTE = "data-chrome-bridge-agent-title-v1";

type TitleOwnership = {
  logicalTitle: string;
  appliedTitle: string;
  ownerId: string;
};

let currentState: AgentUiState = "off";
let logicalTitle = document.title;
let appliedTitle: string | null = null;
let applyingTitle = false;
let titleObserver: MutationObserver | undefined;
let runtimeOwnerId: string | null = null;

export function claimAgentUiRuntime(): void {
  if (ownsAgentUiRuntime()) return;
  const recoveredTitleOwnership = readTitleOwnership();
  runtimeOwnerId = createRuntimeOwnerId();
  document.documentElement.setAttribute(
    RUNTIME_OWNERSHIP_ATTRIBUTE,
    runtimeOwnerId,
  );
  currentState = "off";
  logicalTitle = recoveredTitleOwnership?.logicalTitle ?? document.title;
  appliedTitle = recoveredTitleOwnership?.appliedTitle ?? null;
  applyingTitle = false;
  titleObserver?.disconnect();
  titleObserver = undefined;
  if (recoveredTitleOwnership) {
    writeTitleOwnership({
      ...recoveredTitleOwnership,
      ownerId: runtimeOwnerId,
    });
  }
}

function createRuntimeOwnerId(): string {
  const words = crypto.getRandomValues(new Uint32Array(4));
  return Array.from(words, (word) => word.toString(16).padStart(8, "0")).join(
    "",
  );
}

export function ownsAgentUiRuntime(): boolean {
  return (
    runtimeOwnerId !== null &&
    document.documentElement.getAttribute(RUNTIME_OWNERSHIP_ATTRIBUTE) ===
      runtimeOwnerId
  );
}

export function setAgentUiState(state: AgentUiState): void {
  if (!isAgentUiState(state)) {
    throw new Error(`Invalid agent UI state: ${String(state)}`);
  }
  if (!ownsAgentUiRuntime()) {
    disconnectAgentUiForReloadTest();
    return;
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
  if (!ownsAgentUiRuntime()) return logicalTitle;
  captureExternalTitleChange();
  return logicalTitle;
}

export function disposeAgentUi(): void {
  if (!ownsAgentUiRuntime()) {
    disconnectAgentUiForReloadTest();
    return;
  }
  captureExternalTitleChange();
  removeLegacyIndicator();
  currentState = "off";
  applyTitle();
  titleObserver?.disconnect();
  titleObserver = undefined;
}

export function disconnectAgentUiForReloadTest(): void {
  titleObserver?.disconnect();
  titleObserver = undefined;
}

function removeLegacyIndicator(): void {
  document.getElementById(LEGACY_INDICATOR_HOST_ID)?.remove();
}

function isAgentUiState(value: unknown): value is AgentUiState {
  return value === "off" || value === "target" || value === "operating";
}

function readTitleOwnership(): TitleOwnership | null {
  const encoded = document.documentElement.getAttribute(
    TITLE_OWNERSHIP_ATTRIBUTE,
  );
  if (!encoded) return null;
  try {
    const value = JSON.parse(encoded) as Partial<TitleOwnership>;
    if (
      typeof value.logicalTitle !== "string" ||
      typeof value.appliedTitle !== "string" ||
      typeof value.ownerId !== "string" ||
      !value.ownerId ||
      document.title !== value.appliedTitle ||
      !Object.values(TITLE_PREFIXES).some(
        (prefix) => value.appliedTitle === `${prefix}${value.logicalTitle}`,
      )
    ) {
      clearTitleOwnership();
      return null;
    }
    return {
      logicalTitle: value.logicalTitle,
      appliedTitle: value.appliedTitle,
    };
  } catch {
    clearTitleOwnership();
    return null;
  }
}

function writeTitleOwnership(ownership: TitleOwnership): void {
  document.documentElement.setAttribute(
    TITLE_OWNERSHIP_ATTRIBUTE,
    JSON.stringify(ownership),
  );
}

function clearTitleOwnership(): void {
  document.documentElement.removeAttribute(TITLE_OWNERSHIP_ATTRIBUTE);
}

function ensureTitleObserver(): void {
  if (titleObserver) return;
  titleObserver = new MutationObserver(() => {
    if (applyingTitle) return;
    if (!ownsAgentUiRuntime()) {
      disconnectAgentUiForReloadTest();
      return;
    }
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
    clearTitleOwnership();
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
    if (appliedTitle === null) {
      clearTitleOwnership();
    } else {
      writeTitleOwnership({
        logicalTitle,
        appliedTitle,
        ownerId: runtimeOwnerId!,
      });
    }
    return;
  }
  applyingTitle = true;
  document.title = nextTitle;
  appliedTitle = currentState === "off" ? null : nextTitle;
  if (appliedTitle === null) {
    clearTitleOwnership();
  } else {
    writeTitleOwnership({
      logicalTitle,
      appliedTitle,
      ownerId: runtimeOwnerId!,
    });
  }
  queueMicrotask(() => {
    applyingTitle = false;
  });
}
