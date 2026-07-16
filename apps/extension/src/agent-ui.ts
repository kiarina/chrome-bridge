export type AgentUiState = "off" | "target" | "operating";

const INDICATOR_HOST_ID = "chrome-bridge-agent-indicator";
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
  currentState = state;
  applyTitle();
  renderIndicator();
}

export function getAgentUiState(): AgentUiState {
  return currentState;
}

export function getLogicalDocumentTitle(): string {
  captureExternalTitleChange();
  return logicalTitle;
}

export async function setIndicatorHiddenForCapture(
  hidden: boolean,
): Promise<void> {
  const host = document.getElementById(INDICATOR_HOST_ID);
  if (host) host.style.visibility = hidden ? "hidden" : "visible";
  await nextPaint();
}

export function disposeAgentUi(): void {
  captureExternalTitleChange();
  currentState = "off";
  applyTitle();
  document.getElementById(INDICATOR_HOST_ID)?.remove();
  titleObserver?.disconnect();
  titleObserver = undefined;
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

function renderIndicator(): void {
  const existing = document.getElementById(INDICATOR_HOST_ID);
  if (currentState === "off") {
    existing?.remove();
    return;
  }

  const host = existing || document.createElement("div");
  if (!existing) {
    host.id = INDICATOR_HOST_ID;
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      all: "initial",
      display: "block",
      pointerEvents: "none",
      position: "fixed",
      right: "16px",
      top: "16px",
      visibility: "visible",
      zIndex: "2147483647",
    });
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { color-scheme: light; }
        .indicator {
          align-items: center;
          backdrop-filter: blur(10px);
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(242, 27, 134, 0.28);
          border-radius: 999px;
          box-shadow: 0 8px 24px rgba(114, 8, 61, 0.18);
          color: #72083d;
          display: flex;
          font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
          gap: 7px;
          letter-spacing: 0.01em;
          padding: 8px 11px;
          transition: border-color 140ms ease, box-shadow 140ms ease;
          white-space: nowrap;
        }
        .dot {
          background: #f21b86;
          border-radius: 50%;
          box-shadow: 0 0 0 3px rgba(242, 27, 134, 0.14);
          height: 7px;
          width: 7px;
        }
        .indicator[data-state="operating"] {
          border-color: rgba(242, 27, 134, 0.62);
          box-shadow: 0 8px 26px rgba(184, 15, 98, 0.26);
        }
        .indicator[data-state="operating"] .dot {
          animation: pulse 1s ease-in-out infinite;
          background: #b80f62;
        }
        @keyframes pulse {
          50% { box-shadow: 0 0 0 6px rgba(242, 27, 134, 0.08); transform: scale(1.15); }
        }
        @media (prefers-reduced-motion: reduce) {
          .indicator, .dot { animation: none !important; transition: none !important; }
        }
      </style>
      <div class="indicator"><span class="dot"></span><span class="label"></span></div>
    `;
    document.documentElement.append(host);
  }

  const indicator = host.shadowRoot!.querySelector<HTMLElement>(".indicator")!;
  const label = host.shadowRoot!.querySelector<HTMLElement>(".label")!;
  indicator.dataset.state = currentState;
  label.textContent =
    currentState === "operating" ? "Agent operating" : "Agent target";
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      resolve();
    };
    const fallback = window.setTimeout(finish, 100);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}
