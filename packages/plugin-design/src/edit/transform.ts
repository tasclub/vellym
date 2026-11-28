import type { DesignNode } from "../model/types.js";
import { indexBoard, type BoardIndex } from "./selection.js";

/** A node's unrotated box in world units, centred where the rendered node is. */
export interface WorldBox { cx: number; cy: number; width: number; height: number; rotation: number }
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export interface ResizeOptions { keepRatio: boolean; fromCenter: boolean }

const MIN_SIZE = 1;
const containers = new Set(["frame", "group", "boolean"]);
const rad = (degrees: number) => degrees * Math.PI / 180;
export const rotate = (x: number, y: number, degrees: number) => {
  const a = rad(degrees), c = Math.cos(a), s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
};
const round = (value: number) => Math.round(value * 100) / 100;
export function normalizeAngle(degrees: number): number {
  const value = ((degrees + 180) % 360 + 360) % 360 - 180;
  return round(value === -180 ? 180 : value);
}

/** Sum of the ancestors' rotations, excluding the node itself. */
export function parentRotation(index: BoardIndex, id: string): number {
  let total = 0;
  for (let current: string | undefined = index.get(id)?.parentId; current !== undefined; current = index.get(current)?.parentId)
    total += index.get(current)?.node.rotation ?? 0;
  return total;
}

/**
 * Nodes this ticket may move: not the board root, positioned by x/y (not placed by
 * the parent's flex/grid flow), and not covered by a selected ancestor.
 */
export function movable(index: BoardIndex, ids: readonly string[]): string[] {
  const chosen = new Set(ids);
  return [...chosen].filter(id => {
    const item = index.get(id);
    if (!item || item.parentId === undefined) return false;
    for (let current: string | undefined = item.parentId; current !== undefined; current = index.get(current)?.parentId)
      if (chosen.has(current) && index.get(current)?.parentId !== undefined) return false;
    const parent = index.get(item.parentId)!.node;
    const flow = parent.type === "frame" && (parent.layout?.display === "flex" || parent.layout?.display === "grid");
    return !flow || item.node.position === "absolute";
  });
}

/** Ids that resize: movable nodes, plus the board root (its size, never its place). */
export function resizable(index: BoardIndex, ids: readonly string[]): string[] {
  const root = [...ids].find(id => index.get(id)?.parentId === undefined);
  return root !== undefined && ids.length === 1 ? [root] : movable(index, ids);
}

export function updateNodes(root: DesignNode, changes: ReadonlyMap<string, Partial<DesignNode>>): DesignNode {
  const visit = (node: DesignNode): DesignNode => {
    const patch = changes.get(node.id);
    let next = patch ? { ...node, ...patch } as DesignNode : node;
    if (containers.has(next.type)) {
      const list = (next as { children: DesignNode[] }).children;
      const updated = list.map(visit);
      if (updated.some((child, i) => child !== list[i])) next = { ...next, children: updated } as DesignNode;
    }
    return next;
  };
  return visit(root);
}

/** Move by a world-space delta; each node converts it into its parent's rotated axes. */
export function moveNodes(root: DesignNode, ids: readonly string[], dx: number, dy: number): DesignNode {
  const index = indexBoard(root);
  const changes = new Map<string, Partial<DesignNode>>();
  for (const id of movable(index, ids)) {
    const node = index.get(id)!.node, local = rotate(dx, dy, -parentRotation(index, id));
    changes.set(id, { x: round((node.x ?? 0) + local.x), y: round((node.y ?? 0) + local.y) });
  }
  return changes.size ? updateNodes(root, changes) : root;
}

/** The new world box of one box dragged by a handle, in the box's own rotated axes. */
export function resizeBox(box: WorldBox, handle: Handle, dx: number, dy: number, options: ResizeOptions): WorldBox {
  const local = rotate(dx, dy, -box.rotation);
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.startsWith("n") ? -1 : 0;
  const grow = options.fromCenter ? 2 : 1;
  let width = Math.max(MIN_SIZE, box.width + sx * local.x * grow);
  let height = Math.max(MIN_SIZE, box.height + sy * local.y * grow);
  if (options.keepRatio && box.width > 0 && box.height > 0) {
    const ratio = box.width / box.height;
    if (sx && sy) {
      if (width / box.width >= height / box.height) height = width / ratio; else width = height * ratio;
    } else if (sx) height = width / ratio;
    else width = height * ratio;
  }
  // The edge (or corner) opposite the handle stays put unless resizing from the centre.
  const shift = options.fromCenter ? { x: 0, y: 0 }
    : { x: sx * (width - box.width) / 2, y: sy * (height - box.height) / 2 };
  const centre = rotate(shift.x, shift.y, box.rotation);
  return { ...box, cx: box.cx + centre.x, cy: box.cy + centre.y, width, height };
}

/**
 * Resize several nodes. One node resizes in its own axes; several nodes scale with the
 * axis-aligned box around them, each keeping its own rotation.
 */
export function resizeNodes(root: DesignNode, boxes: ReadonlyMap<string, WorldBox>, handle: Handle,
  dx: number, dy: number, options: ResizeOptions, frame?: WorldBox): DesignNode {
  const index = indexBoard(root);
  const ids = resizable(index, [...boxes.keys()]);
  if (!ids.length) return root;
  const changes = new Map<string, Partial<DesignNode>>();
  const write = (id: string, before: WorldBox, after: WorldBox) => {
    const node = index.get(id)!.node;
    const patch: Partial<DesignNode> = { width: round(after.width), height: round(after.height) };
    if (index.get(id)!.parentId !== undefined) {
      // x/y is the unrotated top-left in the parent's axes: follow the centre's movement.
      const moved = rotate(after.cx - before.cx, after.cy - before.cy, -parentRotation(index, id));
      patch.x = round((node.x ?? 0) + moved.x - (after.width - before.width) / 2);
      patch.y = round((node.y ?? 0) + moved.y - (after.height - before.height) / 2);
    }
    changes.set(id, patch);
  };
  if (ids.length === 1 && !frame) {
    const box = boxes.get(ids[0]!)!;
    write(ids[0]!, box, resizeBox(box, handle, dx, dy, options));
  } else {
    const selected = ids.map(id => boxes.get(id)!);
    const left = Math.min(...selected.map(box => box.cx - box.width / 2));
    const top = Math.min(...selected.map(box => box.cy - box.height / 2));
    const right = Math.max(...selected.map(box => box.cx + box.width / 2));
    const bottom = Math.max(...selected.map(box => box.cy + box.height / 2));
    // A selection across boards passes the frame around all of it, so every board scales alike.
    const union: WorldBox = frame ?? { cx: (left + right) / 2, cy: (top + bottom) / 2, width: right - left, height: bottom - top, rotation: 0 };
    const next = resizeBox(union, handle, dx, dy, options);
    const scaleX = next.width / union.width, scaleY = next.height / union.height;
    for (const id of ids) {
      const box = boxes.get(id)!;
      write(id, box, { ...box, cx: next.cx + (box.cx - union.cx) * scaleX, cy: next.cy + (box.cy - union.cy) * scaleY,
        width: Math.max(MIN_SIZE, box.width * scaleX), height: Math.max(MIN_SIZE, box.height * scaleY) });
    }
  }
  return updateNodes(root, changes);
}

/** Rotate each node about its own centre. With `snap`, the result lands on 15-degree steps. */
export function rotateNodes(root: DesignNode, ids: readonly string[], delta: number, snap: boolean,
  start: ReadonlyMap<string, number>): DesignNode {
  const index = indexBoard(root);
  const changes = new Map<string, Partial<DesignNode>>();
  for (const id of movable(index, ids)) {
    let rotation = (start.get(id) ?? index.get(id)!.node.rotation ?? 0) + delta;
    if (snap) rotation = Math.round(rotation / 15) * 15;
    changes.set(id, { rotation: normalizeAngle(rotation) });
  }
  return changes.size ? updateNodes(root, changes) : root;
}

/** Angle in degrees of a point around a centre, clockwise from the +x axis. */
export const angleOf = (cx: number, cy: number, x: number, y: number) => Math.atan2(y - cy, x - cx) * 180 / Math.PI;

/** The tree without one node (and its children). */
export function removeNode(root: DesignNode, id: string): DesignNode {
  const visit = (node: DesignNode): DesignNode => {
    if (!containers.has(node.type)) return node;
    const list = (node as { children: DesignNode[] }).children;
    const kept = list.filter(child => child.id !== id).map(visit);
    return kept.length === list.length && kept.every((child, i) => child === list[i]) ? node : { ...node, children: kept } as DesignNode;
  };
  return visit(root);
}
