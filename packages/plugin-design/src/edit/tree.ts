import type { DesignNode } from "../model/types.js";
import { indexBoard, type BoardIndex } from "./selection.js";

const containers = new Set(["frame", "group", "boolean"]);
export const isContainer = (node: DesignNode | undefined): node is DesignNode & { children: DesignNode[] } =>
  !!node && containers.has(node.type);
const round = (value: number) => Math.round(value * 100) / 100;

function childrenOf(index: BoardIndex, id: string | undefined): DesignNode[] {
  const node = id === undefined ? undefined : index.get(id)?.node;
  return isContainer(node) ? node.children : [];
}

/** The node's top-left from the board's top-left: the sum of x/y up the tree (rotation is not followed). */
function offsetOf(index: BoardIndex, id: string): { x: number; y: number } {
  let x = 0, y = 0;
  for (let current: string | undefined = id; current !== undefined; current = index.get(current)?.parentId) {
    const item = index.get(current);
    if (!item || item.parentId === undefined) break;
    x += item.node.x ?? 0; y += item.node.y ?? 0;
  }
  return { x, y };
}

/**
 * Move a node under `parentId` at array `position` (0 = bottom-most). Its x/y change so it stays
 * where it was on the board. Moving into itself or its own descendants is refused (undefined).
 */
export function moveTo(root: DesignNode, id: string, parentId: string, position: number): DesignNode | undefined {
  const index = indexBoard(root);
  const item = index.get(id), parent = index.get(parentId)?.node;
  if (!item || item.parentId === undefined || !isContainer(parent)) return;
  for (let current: string | undefined = parentId; current !== undefined; current = index.get(current)?.parentId)
    if (current === id) return;
  const from = childrenOf(index, item.parentId).findIndex(child => child.id === id);
  let at = Math.max(0, Math.min(position, childrenOf(index, parentId).length));
  if (item.parentId === parentId) {
    if (from < at) at -= 1;
    if (from === at) return root;
  }
  let node = item.node;
  if (item.parentId !== parentId && (node.x !== undefined || node.y !== undefined)) {
    const was = offsetOf(index, id), base = parentId === root.id ? { x: 0, y: 0 } : offsetOf(index, parentId);
    node = { ...node, x: round(was.x - base.x), y: round(was.y - base.y) };
  }
  const visit = (current: DesignNode): DesignNode => {
    if (!isContainer(current)) return current;
    let list = current.children.filter(child => child.id !== id).map(visit);
    if (current.id === parentId) list = [...list.slice(0, at), node, ...list.slice(at)];
    return { ...current, children: list } as DesignNode;
  };
  return visit(root);
}

/** One step toward the top (`+1`) or bottom (`-1`) among its siblings. */
export function reorder(root: DesignNode, id: string, delta: 1 | -1): DesignNode | undefined {
  const index = indexBoard(root), item = index.get(id);
  if (!item || item.parentId === undefined) return;
  const siblings = childrenOf(index, item.parentId), at = siblings.findIndex(child => child.id === id);
  const next = at + delta;
  if (next < 0 || next >= siblings.length) return;
  return moveTo(root, id, item.parentId, delta > 0 ? next + 1 : next);
}

/** Out of its parent, just above the parent among the parent's siblings. */
export function moveOut(root: DesignNode, id: string): DesignNode | undefined {
  const index = indexBoard(root), parentId = index.get(id)?.parentId;
  const grand = parentId === undefined ? undefined : index.get(parentId)?.parentId;
  if (parentId === undefined || grand === undefined) return;
  const at = childrenOf(index, grand).findIndex(child => child.id === parentId);
  return moveTo(root, id, grand, at + 1);
}

/** Into the container just below it in the list (its previous sibling), as that container's top child. */
export function moveInto(root: DesignNode, id: string): DesignNode | undefined {
  const index = indexBoard(root), item = index.get(id);
  if (!item || item.parentId === undefined) return;
  const siblings = childrenOf(index, item.parentId), at = siblings.findIndex(child => child.id === id);
  const target = siblings.slice(0, at).reverse().find(child => isContainer(child));
  if (!target) return;
  return moveTo(root, id, target.id, childrenOf(index, target.id).length);
}

/** Where a drop lands: before/after a row (in list order, top first) or inside a container row. */
export function dropTarget(index: BoardIndex, targetId: string, place: "above" | "below" | "inside"):
  { parentId: string; position: number } | undefined {
  const target = index.get(targetId);
  if (!target) return;
  if (place === "inside" || target.parentId === undefined) {
    if (!isContainer(target.node)) return;
    return { parentId: targetId, position: target.node.children.length };
  }
  const at = childrenOf(index, target.parentId).findIndex(child => child.id === targetId);
  // The list shows the top-most child first, so "above" means a higher array position.
  return { parentId: target.parentId, position: place === "above" ? at + 1 : at };
}
