import type { DesignNode } from "../model/types.js";
import type { BoardIndex } from "../edit/selection.js";
import { rotate, updateNodes } from "../edit/transform.js";

export type DrawTool = "frame" | "rectangle" | "ellipse" | "line" | "polygon" | "star";
export type Tool = "select" | "hand" | "text" | DrawTool;
export const DRAW_TOOLS: readonly DrawTool[] = ["frame", "rectangle", "ellipse", "line", "polygon", "star"];
/** Single-key shortcuts (Figma's). Polygon and star are chosen from the shape list. */
export const TOOL_KEYS: Readonly<Record<string, Tool>> = { v: "select", h: "hand", f: "frame", r: "rectangle", o: "ellipse", l: "line", t: "text" };

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

/** A click without a drag makes this size, with its top-left at the point. */
export const DEFAULT_SIZE: Readonly<Record<DrawTool, { width: number; height: number }>> = {
  frame: { width: 100, height: 100 }, rectangle: { width: 100, height: 100 }, ellipse: { width: 100, height: 100 },
  line: { width: 100, height: 0 }, polygon: { width: 100, height: 100 }, star: { width: 100, height: 100 }
};
/** A frame clicked on the empty canvas becomes a phone-sized board, like "Add board". */
export const DEFAULT_BOARD = { width: 390, height: 844 };

/** The dragged box. Shift makes it square (a line keeps 45-degree steps), Alt grows from the start point. */
export function drawBounds(tool: DrawTool, start: Point, end: Point, options: { square: boolean; fromCenter: boolean }): Rect {
  let dx = end.x - start.x, dy = end.y - start.y;
  if (options.square) {
    if (tool === "line") {
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), length = Math.hypot(dx, dy);
      dx = Math.round(Math.cos(angle) * length * 100) / 100;
      dy = Math.round(Math.sin(angle) * length * 100) / 100;
    } else {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * size;
      dy = Math.sign(dy || 1) * size;
    }
  }
  if (tool === "line") {
    // A line goes from its box's top-left to bottom-right: keep the direction by flipping the start.
    const from = options.fromCenter ? { x: start.x - dx, y: start.y - dy } : start;
    const scale = options.fromCenter ? 2 : 1;
    return { x: from.x, y: from.y, width: dx * scale, height: dy * scale };
  }
  if (options.fromCenter) return { x: start.x - Math.abs(dx), y: start.y - Math.abs(dy), width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 };
  return { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

/** A line with a negative width or height is re-expressed so it still runs from start to end. */
function lineBox(box: Rect): Rect & { rotation?: number } {
  if (box.width >= 0 && box.height >= 0) return box;
  // Draw it as a top-left→bottom-right line of the same length, turned to the drawn direction.
  const length = Math.hypot(box.width, box.height);
  const angle = Math.atan2(box.height, box.width) * 180 / Math.PI;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return { x: cx - length / 2, y: cy, width: length, height: 0, rotation: Math.round(angle * 100) / 100 };
}

const round = (value: number) => Math.round(value * 100) / 100;
const GREY = [{ color: "#d9d9d9" }];

export function newNodeId(index: BoardIndex, tool: DrawTool | "image" | "text"): string {
  for (let n = 1; ; n++) if (!index.has(`${tool}-${n}`)) return `${tool}-${n}`;
}

/** The node for a drawn box (already in the parent's coordinates). */
export function createNode(tool: DrawTool, id: string, box: Rect & { rotation?: number }, placed: boolean): DesignNode {
  const shaped = tool === "line" ? lineBox(box) : box;
  const base = {
    id, ...(placed ? { x: round(shaped.x), y: round(shaped.y) } : {}),
    width: round(shaped.width), height: round(shaped.height),
    ...(shaped.rotation ? { rotation: round(shaped.rotation) } : {})
  };
  switch (tool) {
    case "frame": return { ...base, type: "frame", fills: [{ color: "#ffffff" }], children: [] };
    case "rectangle": return { ...base, type: "rectangle", fills: GREY };
    case "ellipse": return { ...base, type: "ellipse", fills: GREY };
    case "line": return { ...base, type: "line", strokes: [{ color: "#000000" }], strokeWidth: 1 };
    case "polygon": return { ...base, type: "polygon", pointCount: 3, fills: GREY };
    case "star": return { ...base, type: "star", pointCount: 5, innerRadius: 0.38, fills: GREY };
  }
}

/** Append as the top-most child of the parent. */
export function insertChild(root: DesignNode, parentId: string, node: DesignNode): DesignNode {
  const parent = findNode(root, parentId);
  if (!parent || parent.type !== "frame") return root;
  return updateNodes(root, new Map([[parentId, { children: [...parent.children, node] } as Partial<DesignNode>]]));
}

function findNode(node: DesignNode, id: string): DesignNode | undefined {
  if (node.id === id) return node;
  if (node.type === "frame" || node.type === "group" || node.type === "boolean")
    for (const child of node.children) { const found = findNode(child, id); if (found) return found; }
}

/** The parent a new node goes into: the deepest frame under the point (the board root at least). */
export function parentFrame(index: BoardIndex, chain: readonly string[]): string | undefined {
  return chain.find(id => {
    const node = index.get(id)?.node;
    return node?.type === "frame" && node.locked !== true;
  });
}

/** A frame flowing its children (flex/grid) places them itself: the new child gets no x/y. */
export function flows(node: DesignNode | undefined): boolean {
  return node?.type === "frame" && (node.layout?.display === "flex" || node.layout?.display === "grid");
}

/**
 * Convert a world box into a parent's coordinates. `parent` is the parent's unrotated world
 * box and total rotation. The child keeps its on-screen orientation by counter-rotating.
 */
export function toParent(box: Rect, parent: { cx: number; cy: number; width: number; height: number; rotation: number }): Rect & { rotation?: number } {
  const centre = rotate(box.x + box.width / 2 - parent.cx, box.y + box.height / 2 - parent.cy, -parent.rotation);
  const cx = centre.x + parent.width / 2, cy = centre.y + parent.height / 2;
  return { x: cx - box.width / 2, y: cy - box.height / 2, width: box.width, height: box.height,
    ...(parent.rotation ? { rotation: -parent.rotation } : {}) };
}

/** The image node for an uploaded file, at most 400 wide, centred on the point. */
export function imageNode(id: string, path: string, natural: { width: number; height: number }, centre: Point, name?: string): DesignNode {
  const scale = natural.width > 400 ? 400 / natural.width : 1;
  const width = round(Math.max(1, natural.width * scale)), height = round(Math.max(1, natural.height * scale));
  return { id, type: "image", asset: path, fit: "fill", x: round(centre.x - width / 2), y: round(centre.y - height / 2),
    width, height, ...(name ? { alt: name } : {}) } as DesignNode;
}
