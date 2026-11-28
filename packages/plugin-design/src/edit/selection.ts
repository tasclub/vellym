import type { DesignNode } from "../model/types.js";

export interface Selection { board: string; id: string }
export interface IndexedNode { node: DesignNode; parentId?: string; depth: number }
export type BoardIndex = Map<string, IndexedNode>;

export function indexBoard(root: DesignNode): BoardIndex {
  const index: BoardIndex = new Map();
  const visit = (node: DesignNode, parentId?: string, depth = 0) => {
    index.set(node.id, { node, parentId, depth });
    if (node.type === "frame" || node.type === "group" || node.type === "boolean")
      node.children.forEach(child => visit(child, node.id, depth + 1));
  };
  visit(root);
  return index;
}

export function selectable(index: BoardIndex, id: string): boolean {
  const item = index.get(id);
  return !!item && item.node.locked !== true && item.node.visible !== false &&
    (item.parentId === undefined || selectable(index, item.parentId));
}

export function prune(index: BoardIndex, ids: readonly string[]): string[] {
  return [...new Set(ids)].filter(id => selectable(index, id));
}

/** Chains run from the deepest hit to the board root. Hit testing skips blocked chains. */
export function pickAt(index: BoardIndex, chain: readonly string[], selection: readonly string[],
  mode: "normal" | "deep" | "enter"): string | undefined {
  if (!chain.length || chain.some(id => !selectable(index, id))) return;
  if (mode === "deep") return chain[0];
  if (mode === "enter") {
    const at = chain.findIndex(id => selection.includes(id));
    if (at >= 0) return chain[Math.max(0, at - 1)];
  }
  // Re-pick at the selection's level. A selected board root has no peers: clicking inside it picks its child.
  const peers = chain.find(id => selection.some(selected =>
    index.get(selected)?.parentId !== undefined && index.get(selected)!.parentId === index.get(id)!.parentId));
  return peers ?? chain[Math.max(0, chain.length - 2)];
}

export function children(index: BoardIndex, selection: readonly string[]): string[] {
  return prune(index, selection.flatMap(id => {
    const node = index.get(id)?.node;
    const eligible = node && (node.type === "frame" || node.type === "group" || node.type === "boolean")
      ? node.children.filter(child => selectable(index, child.id)).map(child => child.id) : [];
    return eligible.length ? eligible : [id];
  }));
}

export function parents(index: BoardIndex, selection: readonly string[]): string[] {
  return prune(index, selection.map(id => index.get(id)?.parentId ?? id));
}
