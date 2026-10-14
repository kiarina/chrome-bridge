import {
  generateAriaTree,
  renderAriaTree,
  type AriaNode,
} from "./vendor/playwright-v1.51.1/ariaSnapshot";
import {
  beginAriaCaches,
  endAriaCaches,
  getAriaRole,
  getElementAccessibleName,
} from "./vendor/playwright-v1.51.1/roleUtils";
import { normalizeWhiteSpace } from "./vendor/playwright-v1.51.1/stringUtils";

export type SnapshotResult = {
  generation: number;
  /** The generation every ref of this document carries (see RefState). */
  refEpoch: number;
  url: string;
  title: string;
  snapshot: string;
};

/**
 * The refs of this document. An element keeps its id from one snapshot to the
 * next, so refs survive page actions; all refs carry the generation of the
 * first snapshot after the state was cleared (`epoch`). Each id remembers the
 * role and accessible name its element had when the id was given: a ref whose
 * element left the page, or now has another role or name (a framework reusing
 * the node for other content), is stale.
 */
type RefState = {
  epoch: number;
  nextId: number;
  ids: WeakMap<Element, number>;
  entries: Map<number, { element: WeakRef<Element>; role: string; name: string }>;
};

const ARIA_REF_PATTERN = /^s(\d+)e(\d+)$/;
let refState: RefState | null = null;

function ariaIdentity(element: Element): { role: string; name: string } {
  return {
    role: getAriaRole(element) ?? "generic",
    name: normalizeWhiteSpace(getElementAccessibleName(element, false) || ""),
  };
}

export function generateSnapshot(generation: number): SnapshotResult {
  if (!Number.isSafeInteger(generation) || generation < 1)
    throw new Error("Snapshot generation must be a positive integer");

  const tree = generateAriaTree(document.documentElement);
  const state: RefState = (refState ??= {
    epoch: generation,
    nextId: 1,
    ids: new WeakMap(),
    entries: new Map(),
  });
  for (const [id, entry] of state.entries) {
    if (!entry.element.deref()?.isConnected) state.entries.delete(id);
  }
  const refs = new Map<Element, string>();
  beginAriaCaches();
  try {
    for (const element of tree.ids.keys()) {
      const identity = ariaIdentity(element);
      let id = state.ids.get(element);
      const entry = id === undefined ? undefined : state.entries.get(id);
      if (
        id === undefined ||
        !entry ||
        entry.role !== identity.role ||
        entry.name !== identity.name
      ) {
        id = state.nextId++;
        state.ids.set(element, id);
        state.entries.set(id, { element: new WeakRef(element), ...identity });
      }
      refs.set(element, `s${state.epoch}e${id}`);
    }
  } finally {
    endAriaCaches();
  }

  return {
    generation,
    refEpoch: state.epoch,
    url: window.location.href,
    title: document.title,
    snapshot: renderAriaTree(tree.root, { refs }),
  };
}

export function resolveAriaRef(ref: string): Element {
  const match = ARIA_REF_PATTERN.exec(ref);
  if (!match) throw new Error(`Invalid aria-ref: ${ref}`);
  if (!refState) throw new Error("No accessibility snapshot is available");

  const epoch = Number(match[1]);
  const elementId = Number(match[2]);
  if (epoch !== refState.epoch) throw new Error(`Stale aria-ref: ${ref}`);

  const entry = refState.entries.get(elementId);
  const element = entry?.element.deref();
  if (!entry || !element || !element.isConnected)
    throw new Error(`Stale aria-ref: ${ref} (its element is no longer on the page)`);
  beginAriaCaches();
  let identity: { role: string; name: string };
  try {
    identity = ariaIdentity(element);
  } finally {
    endAriaCaches();
  }
  if (identity.role !== entry.role || identity.name !== entry.name) {
    throw new Error(
      `Stale aria-ref: ${ref} (its element changed from ${entry.role} ${JSON.stringify(entry.name)} to ${identity.role} ${JSON.stringify(identity.name)})`,
    );
  }
  return element;
}

export function clearSnapshotState(): void {
  refState = null;
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
