import { resolveAriaRef } from "./snapshot";

export type ClickPoint = {
  x: number;
  y: number;
  settleMs?: number;
};

export type DragPoints = {
  start: ClickPoint;
  end: ClickPoint;
};

export type StableDomResult = {
  stable: boolean;
  elapsedMs: number;
};

export type SelectPreparation = ClickPoint & {
  values: string[];
};

const CURSOR_ID = "chrome-bridge-virtual-cursor";
const MIN_CURSOR_MOVE_MS = 100;
const MAX_CURSOR_MOVE_MS = 320;
let lastCursorPoint: { x: number; y: number } | undefined;

export function prepareClickTarget(ref: string): ClickPoint {
  const element = resolveAriaRef(ref);
  return preparePoint(element, ref);
}

export function prepareTypeTarget(ref: string): ClickPoint {
  const element = resolveAriaRef(ref);
  if (!isEditable(element)) {
    throw new Error(`Element for aria-ref is not editable: ${ref}`);
  }
  return preparePoint(element, ref);
}

export function prepareDragTargets(
  startRef: string,
  endRef: string,
): DragPoints {
  const startElement = resolveAriaRef(startRef);
  const endElement = resolveAriaRef(endRef);
  startElement.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "auto",
  });
  const startPoint = clickablePoint(startElement);
  if (!startPoint) {
    throw new Error(`Start element for aria-ref is not clickable: ${startRef}`);
  }
  const end = visiblePoint(endElement);
  if (!end) {
    throw new Error(`End element for aria-ref is not visible: ${endRef}`);
  }
  const start = showVirtualCursor(startPoint);
  return { start, end };
}

export function moveVirtualCursor(
  point: Pick<ClickPoint, "x" | "y">,
  durationMs?: number,
): ClickPoint {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0
  ) {
    throw new Error("Virtual cursor coordinates must be non-negative numbers");
  }
  return showVirtualCursor(point, durationMs);
}

export function pressVirtualCursor(): void {
  const host = document.getElementById(CURSOR_ID);
  const cursor = host?.shadowRoot?.querySelector<HTMLElement>(".cursor");
  const ripple = host?.shadowRoot?.querySelector<HTMLElement>(".ripple");
  if (!cursor || !ripple) return;
  cursor.classList.remove("pressing");
  ripple.classList.remove("active");
  void cursor.offsetWidth;
  cursor.classList.add("pressing");
  ripple.classList.add("active");
  window.setTimeout(() => {
    cursor.classList.remove("pressing");
    ripple.classList.remove("active");
  }, 360);
}

export function setVirtualCursorPressed(pressed: boolean): void {
  const cursor = document
    .getElementById(CURSOR_ID)
    ?.shadowRoot?.querySelector<HTMLElement>(".cursor");
  cursor?.classList.toggle("pressed", pressed);
}

export function removeVirtualCursor(): void {
  document.getElementById(CURSOR_ID)?.remove();
  lastCursorPoint = undefined;
}

export function selectOptions(ref: string, values: string[]): string[] {
  const preparation = prepareSelectOptions(ref, values);
  pressVirtualCursor();
  return performSelectOptions(ref, preparation.values);
}

export function prepareSelectOptions(
  ref: string,
  values: string[],
): SelectPreparation {
  const element = resolveAriaRef(ref);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Element for aria-ref is not a <select>: ${ref}`);
  }
  if (element.disabled) {
    throw new Error(`Element for aria-ref is disabled: ${ref}`);
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("values must contain at least one option value");
  }
  if (values.some((value) => typeof value !== "string")) {
    throw new Error("values must contain only strings");
  }

  const requested = element.multiple ? values : [values[0]];
  const options = Array.from(element.options);
  for (const value of requested) {
    if (!options.some((option) => option.value === value)) {
      throw new Error(`Unable to find option for value: ${value}`);
    }
  }

  element.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "auto",
  });
  const point = clickablePoint(element);
  if (!point) throw new Error(`Element for aria-ref is not clickable: ${ref}`);
  return { ...showVirtualCursor(point), values: requested };
}

export function performSelectOptions(
  ref: string,
  values: string[],
): string[] {
  const element = resolveAriaRef(ref);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Element for aria-ref is not a <select>: ${ref}`);
  }
  if (element.disabled) {
    throw new Error(`Element for aria-ref is disabled: ${ref}`);
  }
  const options = Array.from(element.options);
  const selectedValues = new Set(values);
  for (const option of options)
    option.selected = selectedValues.has(option.value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return Array.from(element.selectedOptions, (option) => option.value);
}

function preparePoint(element: Element, ref: string): ClickPoint {
  element.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "auto",
  });

  const point = clickablePoint(element);
  if (!point) throw new Error(`Element for aria-ref is not clickable: ${ref}`);
  return showVirtualCursor(point);
}

function isEditable(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  if (element instanceof HTMLInputElement) {
    const nonTextTypes = new Set([
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ]);
    return (
      !element.disabled && !element.readOnly && !nonTextTypes.has(element.type)
    );
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

export function waitForStableDOM(
  idleMs = 1_000,
  timeoutMs = 3_000,
): Promise<StableDomResult> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    let idleTimer: number | undefined;
    let timeoutTimer: number | undefined;
    let settled = false;

    const finish = (stable: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      resolve({ stable, elapsedMs: performance.now() - startedAt });
    };

    const scheduleIdle = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => finish(true), idleMs);
    };

    const observer = new MutationObserver(scheduleIdle);
    observer.observe(document, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    scheduleIdle();
    timeoutTimer = window.setTimeout(() => finish(false), timeoutMs);
  });
}

function clickablePoint(element: Element): ClickPoint | null {
  for (const rect of element.getClientRects()) {
    const left = Math.max(0, rect.left);
    const right = Math.min(window.innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) continue;

    const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const hit = deepElementFromPoint(point.x, point.y);
    if (hit === element || (hit && element.contains(hit))) return point;
  }
  return null;
}

function visiblePoint(element: Element): ClickPoint | null {
  for (const rect of element.getClientRects()) {
    const left = Math.max(0, rect.left);
    const right = Math.min(window.innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    if (right > left && bottom > top) {
      return { x: (left + right) / 2, y: (top + bottom) / 2 };
    }
  }
  return null;
}

function deepElementFromPoint(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const nested = hit.shadowRoot.elementFromPoint(x, y);
    if (!nested || nested === hit) break;
    hit = nested;
  }
  return hit;
}

function showVirtualCursor(
  point: Pick<ClickPoint, "x" | "y">,
  requestedDurationMs?: number,
): ClickPoint {
  let host = document.getElementById(CURSOR_ID);
  const isNew = !host;
  if (!host) {
    host = document.createElement("div");
    host.id = CURSOR_ID;
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      all: "initial",
      display: "block",
      height: "34px",
      left: "0",
      pointerEvents: "none",
      position: "fixed",
      top: "0",
      width: "30px",
      zIndex: "2147483647",
    });
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { color-scheme: light; }
        .cursor {
          filter: drop-shadow(0 3px 4px rgba(114, 8, 61, 0.34));
          height: 30px;
          left: -2px;
          position: absolute;
          top: -2px;
          transform-origin: 3px 3px;
          width: 26px;
        }
        .cursor.pressing { animation: press 320ms cubic-bezier(.22, 1, .36, 1); }
        .cursor.pressed { transform: scale(.86); }
        .ripple {
          border: 2px solid rgba(242, 27, 134, .72);
          border-radius: 50%;
          height: 8px;
          left: -5px;
          opacity: 0;
          position: absolute;
          top: -5px;
          transform: scale(.25);
          width: 8px;
        }
        .ripple.active { animation: ripple 340ms ease-out; }
        @keyframes press {
          35% { transform: scale(.82); }
          100% { transform: scale(1); }
        }
        @keyframes ripple {
          0% { opacity: .95; transform: scale(.25); }
          100% { opacity: 0; transform: scale(2.8); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cursor, .ripple { animation: none !important; transition: none !important; }
        }
      </style>
      <span class="ripple"></span>
      <svg class="cursor" viewBox="0 0 26 30" aria-hidden="true">
        <path d="M2 2 L2 23 L7.7 17.8 L12.4 28 L17.1 25.8 L12.4 16.2 L20.2 15.4 Z"
          fill="#f21b86" stroke="white" stroke-width="2.4" stroke-linejoin="round" />
      </svg>
    `;
    document.documentElement.append(host);
  }

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const durationMs = reducedMotion
    ? 0
    : isNew
      ? 0
      : normalizeMoveDuration(point, requestedDurationMs);
  host.style.transition =
    durationMs === 0
      ? "none"
      : `left ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  host.style.left = `${point.x}px`;
  host.style.top = `${point.y}px`;
  lastCursorPoint = { x: point.x, y: point.y };
  return { ...point, settleMs: durationMs };
}

function normalizeMoveDuration(
  point: Pick<ClickPoint, "x" | "y">,
  requestedDurationMs?: number,
): number {
  if (requestedDurationMs !== undefined) {
    return Math.max(0, Math.min(MAX_CURSOR_MOVE_MS, requestedDurationMs));
  }
  if (!lastCursorPoint) return 0;
  const distance = Math.hypot(
    point.x - lastCursorPoint.x,
    point.y - lastCursorPoint.y,
  );
  if (distance === 0) return 0;
  return Math.round(
    Math.max(MIN_CURSOR_MOVE_MS, Math.min(MAX_CURSOR_MOVE_MS, distance * 0.65)),
  );
}
