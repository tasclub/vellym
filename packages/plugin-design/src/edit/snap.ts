import type { LayoutGrid } from "../model/types.js";
import type { Bounds } from "../canvas/viewport.js";
import type { Handle } from "./transform.js";

/** A line drawn while snapping: `x` set for a vertical line, `y` for a horizontal one, over [from, to]. */
export interface Guide { axis: "x" | "y"; at: number; from: number; to: number }
/** An equal-spacing mark: the gap and where to draw it. */
export interface Gap { axis: "x" | "y"; from: number; to: number; at: number; size: number }
export interface SnapTargets { boxes: Bounds[]; lines: { x: number[]; y: number[] } }
export interface SnapResult { dx: number; dy: number; guides: Guide[]; gaps: Gap[] }

const edges = (box: Bounds, axis: "x" | "y") => axis === "x"
  ? [box.x, box.x + box.width / 2, box.x + box.width] : [box.y, box.y + box.height / 2, box.y + box.height];
const span = (box: Bounds, axis: "x" | "y") => axis === "x" ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
const round = (value: number) => Math.round(value * 100) / 100;

/** The best offset (smallest move) within `threshold` that puts one of `moving` on one of `fixed`. */
function nearest(moving: readonly number[], fixed: readonly number[], threshold: number): number | undefined {
  let best: number | undefined;
  for (const a of moving) for (const b of fixed) {
    const delta = b - a;
    if (Math.abs(delta) <= threshold && (best === undefined || Math.abs(delta) < Math.abs(best))) best = delta;
  }
  return best;
}

/** Equal gaps: an offset that centres `box` between the nearest neighbours on each side along an axis. */
function spacing(box: Bounds, boxes: readonly Bounds[], axis: "x" | "y", threshold: number): { delta: number; gaps: Gap[] } | undefined {
  const size = axis === "x" ? "width" : "height", cross = axis === "x" ? "y" : "x", crossSize = axis === "x" ? "height" : "width";
  const overlapping = boxes.filter(other => other[cross] < box[cross] + box[crossSize] && other[cross] + other[crossSize] > box[cross]);
  const before = overlapping.filter(other => other[axis] + other[size] <= box[axis] + threshold)
    .sort((a, b) => (b[axis] + b[size]) - (a[axis] + a[size]))[0];
  const after = overlapping.filter(other => other[axis] >= box[axis] + box[size] - threshold).sort((a, b) => a[axis] - b[axis])[0];
  if (!before || !after) return;
  const room = after[axis] - (before[axis] + before[size]) - box[size];
  if (room < 0) return;
  const target = before[axis] + before[size] + room / 2, delta = target - box[axis];
  if (Math.abs(delta) > threshold) return;
  // Draw the gaps across the middle of where all three overlap.
  const top = Math.max(before[cross], after[cross], box[cross]);
  const bottom = Math.min(before[cross] + before[crossSize], after[cross] + after[crossSize], box[cross] + box[crossSize]);
  const mid = round((top + bottom) / 2);
  const gap = round(room / 2);
  return { delta, gaps: [
    { axis, from: before[axis] + before[size], to: target, at: mid, size: gap },
    { axis, from: target + box[size], to: after[axis], at: mid, size: gap }
  ] };
}

/**
 * Snap a moving box (already moved by the drag) to the targets' edges and centres, to grid lines,
 * and to equal gaps between neighbours. Returns the extra offset and what to draw.
 */
export function snapBox(box: Bounds, targets: SnapTargets, threshold: number, only?: { x: number[]; y: number[] }): SnapResult {
  const result: SnapResult = { dx: 0, dy: 0, guides: [], gaps: [] };
  for (const axis of ["x", "y"] as const) {
    const moving = only?.[axis] ?? edges(box, axis);
    const fixed = [...targets.boxes.flatMap(other => edges(other, axis)), ...targets.lines[axis]];
    let delta = nearest(moving, fixed, threshold);
    let gaps: Gap[] = [];
    if (!only) {
      const even = spacing(box, targets.boxes, axis, threshold);
      if (even && (delta === undefined || Math.abs(even.delta) < Math.abs(delta))) { delta = even.delta; gaps = even.gaps; }
    }
    if (delta === undefined) continue;
    result[axis === "x" ? "dx" : "dy"] = round(delta);
    result.gaps.push(...gaps);
    if (gaps.length) continue;
    // A guide for every edge that now lines up, spanning the box and what it lines up with.
    for (const at of new Set(moving.map(value => round(value + delta!)))) {
      const matches = targets.boxes.filter(other => edges(other, axis).some(value => Math.abs(value - at) < 0.01));
      const isLine = targets.lines[axis].some(value => Math.abs(value - at) < 0.01);
      if (!matches.length && !isLine) continue;
      const moved = axis === "x" ? { ...box, x: box.x + delta } : { ...box, y: box.y + delta };
      const ranges = [span(moved, axis), ...matches.map(other => span(other, axis))];
      result.guides.push({ axis, at, from: Math.min(...ranges.map(range => range[0]!)), to: Math.max(...ranges.map(range => range[1]!)) });
    }
  }
  return result;
}

/** The edges a resize handle moves (the others stay put). */
export function handleEdges(box: Bounds, handle: Handle): { x: number[]; y: number[] } {
  return {
    x: handle.includes("e") ? [box.x + box.width] : handle.includes("w") ? [box.x] : [],
    y: handle.includes("s") ? [box.y + box.height] : handle.startsWith("n") ? [box.y] : []
  };
}

/** One measurement for Alt+hover: a segment and its length. */
export interface Distance { axis: "x" | "y"; from: number; to: number; at: number; size: number }
/** Distances from `a` (the selection) to `b`: to b's inner edges when b holds a, else the gaps between them. */
export function distances(a: Bounds, b: Bounds): Distance[] {
  const out: Distance[] = [];
  const inside = a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  const cy = a.y + a.height / 2, cx = a.x + a.width / 2;
  const push = (axis: "x" | "y", from: number, to: number, at: number) => {
    if (to - from > 0.01) out.push({ axis, from: round(from), to: round(to), at: round(at), size: round(to - from) });
  };
  if (inside) {
    push("x", b.x, a.x, cy); push("x", a.x + a.width, b.x + b.width, cy);
    push("y", b.y, a.y, cx); push("y", a.y + a.height, b.y + b.height, cx);
    return out;
  }
  if (b.x >= a.x + a.width) push("x", a.x + a.width, b.x, cy);
  if (b.x + b.width <= a.x) push("x", b.x + b.width, a.x, cy);
  if (b.y >= a.y + a.height) push("y", a.y + a.height, b.y, cx);
  if (b.y + b.height <= a.y) push("y", b.y + b.height, a.y, cx);
  return out;
}

/**
 * Column, row and square-grid lines inside a frame (world units), as Figma lays them out.
 * Columns/rows: `count` tracks with `gutter` between; `stretch` fills the frame minus `margin`
 * on both sides, other alignments use `size` per track from the start, centre or end.
 */
export function gridRects(frame: Bounds, grid: LayoutGrid): Bounds[] {
  const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  if (grid.pattern === "grid") {
    const size = Math.max(1, num(grid.size, 8)), out: Bounds[] = [];
    for (let x = frame.x; x < frame.x + frame.width - 0.01; x += size)
      for (let y = frame.y; y < frame.y + frame.height - 0.01; y += size)
        out.push({ x, y, width: Math.min(size, frame.x + frame.width - x), height: Math.min(size, frame.y + frame.height - y) });
    return out;
  }
  const vertical = grid.pattern === "columns";
  const length = vertical ? frame.width : frame.height, start = vertical ? frame.x : frame.y;
  const count = Math.max(1, Math.round(num(grid.count, 1))), gutter = num(grid.gutter, 0), margin = num(grid.margin, 0);
  const alignment = grid.alignment ?? "stretch";
  const track = alignment === "stretch" ? (length - margin * 2 - gutter * (count - 1)) / count : num(grid.size, 0);
  const total = track * count + gutter * (count - 1);
  const offset = alignment === "stretch" || alignment === "start" ? margin
    : alignment === "end" ? length - margin - total : (length - total) / 2;
  return Array.from({ length: count }, (_, i) => {
    const at = start + offset + i * (track + gutter);
    return vertical ? { x: at, y: frame.y, width: Math.max(0, track), height: frame.height }
      : { x: frame.x, y: at, width: frame.width, height: Math.max(0, track) };
  });
}

/** The snapping lines of a frame's visible grids: each track's two edges along its axis. */
export function gridLines(frame: Bounds, grids: readonly LayoutGrid[] = []): { x: number[]; y: number[] } {
  const lines = { x: [] as number[], y: [] as number[] };
  for (const grid of grids) {
    if (grid.visible === false || grid.pattern === "grid") continue;
    for (const rect of gridRects(frame, grid)) {
      if (grid.pattern === "columns") lines.x.push(rect.x, rect.x + rect.width);
      else lines.y.push(rect.y, rect.y + rect.height);
    }
  }
  return lines;
}
