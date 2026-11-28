import type { DesignNode } from "../model/types.js";
import type { Bounds } from "../canvas/viewport.js";
import { moveNodes } from "./transform.js";

export type AlignMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

/**
 * World-space moves that align boxes to a frame (the selection's bounds, or the parent for one node).
 * Returned per id so each board applies its own; the caller turns them into node x/y with moveNodes.
 */
export function alignMoves(boxes: ReadonlyMap<string, Bounds>, mode: AlignMode, frame: Bounds): Map<string, { dx: number; dy: number }> {
  const out = new Map<string, { dx: number; dy: number }>();
  for (const [id, box] of boxes) {
    const dx = mode === "left" ? frame.x - box.x : mode === "right" ? frame.x + frame.width - box.x - box.width
      : mode === "centerX" ? frame.x + frame.width / 2 - box.x - box.width / 2 : 0;
    const dy = mode === "top" ? frame.y - box.y : mode === "bottom" ? frame.y + frame.height - box.y - box.height
      : mode === "centerY" ? frame.y + frame.height / 2 - box.y - box.height / 2 : 0;
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) out.set(id, { dx, dy });
  }
  return out;
}

/** Equal gaps between three or more boxes along an axis; the first and last stay. */
export function distributeMoves(boxes: ReadonlyMap<string, Bounds>, axis: "x" | "y"): Map<string, { dx: number; dy: number }> {
  const out = new Map<string, { dx: number; dy: number }>();
  if (boxes.size < 3) return out;
  const size = axis === "x" ? "width" : "height";
  const sorted = [...boxes].sort(([, a], [, b]) => a[axis] - b[axis] || a[size] - b[size]);
  const first = sorted[0]![1], last = sorted.at(-1)![1];
  const total = sorted.reduce((sum, [, box]) => sum + box[size], 0);
  const gap = (last[axis] + last[size] - first[axis] - total) / (sorted.length - 1);
  let at = first[axis] + first[size] + gap;
  for (const [id, box] of sorted.slice(1, -1)) {
    const delta = at - box[axis];
    if (Math.abs(delta) > 0.001) out.set(id, axis === "x" ? { dx: delta, dy: 0 } : { dx: 0, dy: delta });
    at += box[size] + gap;
  }
  return out;
}

export function applyMoves(root: DesignNode, moves: ReadonlyMap<string, { dx: number; dy: number }>): DesignNode {
  let tree = root;
  for (const [id, { dx, dy }] of moves) tree = moveNodes(tree, [id], dx, dy);
  return tree;
}
