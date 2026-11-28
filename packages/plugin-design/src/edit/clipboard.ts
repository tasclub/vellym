import type { DesignNode } from "../model/types.js";
import { indexBoard, type BoardIndex } from "./selection.js";
import { removeNode } from "./transform.js";
import { isContainer } from "./tree.js";
import { DESIGN_NODE_SCHEMA } from "../model/schema.js";
import { matchesSchema } from "../model/check.js";

/** What is copied: nodes with their own subtrees (selected descendants of a selected node are not repeated). */
export interface Copied { nodes: DesignNode[]; board: string; parentIds: string[] }
export const CLIPBOARD_MARKER = "vellym-design-nodes";

export function collect(index: BoardIndex, ids: readonly string[]): { nodes: DesignNode[]; parentIds: string[] } {
  const chosen = new Set(ids), nodes: DesignNode[] = [], parentIds: string[] = [];
  for (const id of ids) {
    const item = index.get(id);
    if (!item || item.parentId === undefined) continue;
    let covered = false;
    for (let current: string | undefined = item.parentId; current !== undefined; current = index.get(current)?.parentId)
      if (chosen.has(current) && index.get(current)?.parentId !== undefined) covered = true;
    if (!covered) { nodes.push(structuredClone(item.node)); parentIds.push(item.parentId); }
  }
  return { nodes, parentIds };
}

/** The JSON put on the system clipboard (`text/plain`), and reading it back. */
export function serialize(copied: Copied): string {
  return JSON.stringify({ [CLIPBOARD_MARKER]: 1, ...copied });
}
/**
 * Our nodes on the clipboard: `undefined` when the text is not ours (paste nothing, say nothing),
 * `invalid` when it is ours but a node does not fit the design format (say so, paste nothing).
 */
export function parseClipboard(text: string): Copied | "invalid" | undefined {
  let value: Record<string, unknown>;
  try { value = JSON.parse(text) as Record<string, unknown>; } catch { return; }
  if (typeof value !== "object" || value === null || value[CLIPBOARD_MARKER] !== 1) return;
  if (!Array.isArray(value.nodes) || !value.nodes.length) return "invalid";
  const schema = DESIGN_NODE_SCHEMA as Record<string, unknown>;
  if (!value.nodes.every(node => matchesSchema(node, schema, schema))) return "invalid";
  return { nodes: value.nodes as DesignNode[], board: String(value.board ?? ""),
    parentIds: Array.isArray(value.parentIds) ? value.parentIds.map(String) : [] };
}

/** A fresh, unused id like `rectangle-3` (ids match ^[a-z0-9][a-z0-9-]{0,39}$). */
function freshId(id: string, taken: Set<string>): string {
  const base = (id.replace(/-\d+$/, "") || "node").slice(0, 34);
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
  }
}
/** Copy a subtree with new ids for every node. Instances keep their `component` (no component is copied). */
export function renumber(node: DesignNode, taken: Set<string>): DesignNode {
  const copy = { ...structuredClone(node), id: freshId(node.id, taken) } as DesignNode;
  if (isContainer(copy)) (copy as { children: DesignNode[] }).children = (copy as { children: DesignNode[] }).children.map(child => renumber(child, taken));
  return copy;
}

const shift = (node: DesignNode, dx: number, dy: number): DesignNode =>
  node.x === undefined && node.y === undefined ? node : { ...node, x: (node.x ?? 0) + dx, y: (node.y ?? 0) + dy };

/** Insert nodes as the top-most children of `parentId`. */
function insertTop(root: DesignNode, parentId: string, nodes: readonly DesignNode[]): DesignNode {
  const visit = (node: DesignNode): DesignNode => {
    if (!isContainer(node)) return node;
    const children = node.children.map(visit);
    return { ...node, children: node.id === parentId ? [...children, ...nodes] : children } as DesignNode;
  };
  return visit(root);
}

/** Copies right above each original, moved by (dx, dy). Returns the new root and the copies' ids. */
export function duplicate(root: DesignNode, ids: readonly string[], dx: number, dy: number): { root: DesignNode; ids: string[] } {
  const index = indexBoard(root), taken = new Set(index.keys());
  const { nodes, parentIds } = collect(index, ids);
  const copies = new Map<string, DesignNode>();
  nodes.forEach(node => copies.set(node.id, shift(renumber(node, taken), dx, dy)));
  const visit = (node: DesignNode): DesignNode => {
    if (!isContainer(node)) return node;
    const children = node.children.flatMap(child => {
      const next = visit(child), copy = copies.get(child.id);
      return copy && parentIds[nodes.findIndex(item => item.id === child.id)] === node.id ? [next, copy] : [next];
    });
    return { ...node, children } as DesignNode;
  };
  return { root: copies.size ? visit(root) : root, ids: [...copies.values()].map(node => node.id) };
}

/** Paste into a frame (top-most). Pasting where the originals still sit offsets by 10 so the copy shows. */
export function paste(root: DesignNode, parentId: string, copied: Copied, sameBoard: boolean): { root: DesignNode; ids: string[] } {
  const index = indexBoard(root), taken = new Set(index.keys());
  if (!isContainer(index.get(parentId)?.node)) return { root, ids: [] };
  const offset = sameBoard && copied.nodes.some((node, i) => copied.parentIds[i] === parentId && index.has(node.id)) ? 10 : 0;
  const nodes = copied.nodes.map(node => shift(renumber(node, taken), offset, offset));
  return { root: nodes.length ? insertTop(root, parentId, nodes) : root, ids: nodes.map(node => node.id) };
}

export function removeNodes(root: DesignNode, ids: readonly string[]): DesignNode {
  const index = indexBoard(root);
  return ids.filter(id => index.get(id)?.parentId !== undefined).reduce((tree, id) => removeNode(tree, id), root);
}
