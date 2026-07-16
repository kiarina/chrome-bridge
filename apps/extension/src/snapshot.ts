import {
  generateAriaTree,
  renderAriaTree,
  type AriaNode,
} from "./vendor/playwright-v1.51.1/ariaSnapshot";

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
