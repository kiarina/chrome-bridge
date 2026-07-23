import {
  generateAriaTree,
  renderAriaTree,
  type AriaNode,
} from "./vendor/playwright-v1.51.1/ariaSnapshot";
import { normalizeWhiteSpace } from "./vendor/playwright-v1.51.1/stringUtils";

export type SnapshotResult = {
  generation: number;
  url: string;
  title: string;
  snapshot: string;
};

export type SnapshotState = {
  generation: number;
  root: AriaNode;
  elements: Map<number, Element>;
  ids: Map<Element, number>;
};

const ARIA_REF_PATTERN = /^s(\d+)e(\d+)$/;
let currentSnapshotState: SnapshotState | null = null;

export function generateSnapshot(generation: number): SnapshotResult {
  if (!Number.isSafeInteger(generation) || generation < 1)
    throw new Error("Snapshot generation must be a positive integer");

  const tree = generateAriaTree(document.documentElement);
  const refs = new Map<Element, string>();
  for (const [element, id] of tree.ids)
    refs.set(element, `s${generation}e${id}`);

  currentSnapshotState = {
    generation,
    root: tree.root,
    elements: tree.elements,
    ids: tree.ids,
  };

  return {
    generation,
    url: window.location.href,
    title: document.title,
    snapshot: renderAriaTree(tree.root, { refs }),
  };
}

export function resolveAriaRef(ref: string): Element {
  const match = ARIA_REF_PATTERN.exec(ref);
  if (!match) throw new Error(`Invalid aria-ref: ${ref}`);
  if (!currentSnapshotState)
    throw new Error("No accessibility snapshot is available");

  const generation = Number(match[1]);
  const elementId = Number(match[2]);
  if (generation !== currentSnapshotState.generation)
    throw new Error(`Stale aria-ref: ${ref}`);

  const element = currentSnapshotState.elements.get(elementId);
  if (!element || !element.isConnected)
    throw new Error(`Unknown aria-ref: ${ref}`);
  return element;
}

export function clearSnapshotState(): void {
  currentSnapshotState = null;
}

export type WaitForAriaTextState = "visible" | "hidden";

function flattenedAriaText(node: AriaNode): string {
  const values: string[] = [];
  const visit = (current: AriaNode) => {
    if (current.name) values.push(current.name);
    for (const child of current.children) {
      if (typeof child === "string") values.push(child);
      else visit(child);
    }
  };
  visit(node);
  return normalizeWhiteSpace(values.join(" "));
}

export function ariaTextContains(text: string): boolean {
  const expected = normalizeWhiteSpace(text);
  if (!expected) throw new Error("text must contain non-whitespace characters");
  const tree = generateAriaTree(document.documentElement);
  return flattenedAriaText(tree.root).includes(expected);
}

export function waitForAriaText(
  text: string,
  state: WaitForAriaTextState,
  timeoutMs: number,
): Promise<{ matched: true; elapsedMs: number }> {
  if (state !== "visible" && state !== "hidden")
    throw new Error("state must be visible or hidden");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 10_000)
    throw new Error("timeout must be between 0 and 10 seconds");

  const startedAt = performance.now();
  const matches = () => ariaTextContains(text) === (state === "visible");
  if (matches()) return Promise.resolve({ matched: true, elapsedMs: 0 });
  if (timeoutMs === 0)
    return Promise.reject(
      new Error(`Timed out waiting for text to become ${state}: ${JSON.stringify(text)}`),
    );

  return new Promise((resolve, reject) => {
    let settled = false;
    let checking = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve({ matched: true, elapsedMs: performance.now() - startedAt });
    };
    const check = () => {
      if (settled || checking) return;
      checking = true;
      try {
        if (matches()) finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      } finally {
        checking = false;
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const interval = window.setInterval(check, 100);
    const timeout = window.setTimeout(
      () =>
        finish(
          new Error(
            `Timed out waiting for text to become ${state}: ${JSON.stringify(text)}`,
          ),
        ),
      timeoutMs,
    );
  });
}
