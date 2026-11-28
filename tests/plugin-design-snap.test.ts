import { describe, expect, it } from "vitest";
import { distances, gridLines, gridRects, handleEdges, snapBox } from "../packages/plugin-design/src/edit/snap.js";

const none = { x: [], y: [] };
describe("snapping", () => {
  it("pulls edges and centres onto the nearest target within the threshold and draws guides", () => {
    const parent = { x: 0, y: 0, width: 400, height: 300 };
    const sibling = { x: 200, y: 50, width: 100, height: 40 };
    // Left edge 197 → 200 (sibling's left), top 52 → 50.
    const result = snapBox({ x: 197, y: 52, width: 50, height: 20 }, { boxes: [parent, sibling], lines: none }, 4);
    expect(result).toMatchObject({ dx: 3, dy: -2 });
    // x=200 is also the parent's centre, so the guide spans the parent too.
    expect(result.guides).toContainEqual({ axis: "x", at: 200, from: 0, to: 300 });
    expect(result.guides).toContainEqual({ axis: "x", at: 250, from: 50, to: 90 });
    expect(snapBox({ x: 190, y: 120, width: 50, height: 20 }, { boxes: [sibling], lines: none }, 4)).toMatchObject({ dx: 0, dy: 0, guides: [] });
    // The centre lines up with the parent's centre.
    expect(snapBox({ x: 173, y: 140, width: 50, height: 20 }, { boxes: [parent], lines: none }, 4).dx).toBe(2);
  });
  it("snaps to equal gaps between neighbours and reports the gap", () => {
    const left = { x: 0, y: 0, width: 50, height: 50 }, right = { x: 200, y: 0, width: 50, height: 50 };
    const result = snapBox({ x: 98, y: 10, width: 50, height: 30 }, { boxes: [left, right], lines: none }, 4);
    expect(result.dx).toBe(2);
    expect(result.gaps.map(gap => gap.size)).toEqual([50, 50]);
  });
  it("snaps only the dragged edges when resizing, and to grid lines", () => {
    const box = { x: 10, y: 10, width: 88, height: 40 };
    expect(handleEdges(box, "se")).toEqual({ x: [98], y: [50] });
    expect(snapBox(box, { boxes: [], lines: { x: [100], y: [] } }, 4, handleEdges(box, "e"))).toMatchObject({ dx: 2, dy: 0 });
  });
});

describe("measuring and grids", () => {
  it("measures gaps between boxes, or to the edges of a box around it", () => {
    expect(distances({ x: 0, y: 0, width: 10, height: 10 }, { x: 30, y: 0, width: 10, height: 10 })).toEqual([{ axis: "x", from: 10, to: 30, at: 5, size: 20 }]);
    expect(distances({ x: 10, y: 20, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 100 }).map(item => item.size)).toEqual([10, 80, 20, 70]);
  });
  it("lays out stretched and fixed columns, rows and square grids", () => {
    const frame = { x: 0, y: 0, width: 400, height: 200 };
    expect(gridRects(frame, { pattern: "columns", count: 4, gutter: 20, margin: 10 }).map(rect => [rect.x, rect.width]))
      .toEqual([[10, 80], [110, 80], [210, 80], [310, 80]]);
    expect(gridRects(frame, { pattern: "columns", count: 2, gutter: 20, size: 100, alignment: "center" }).map(rect => rect.x)).toEqual([90, 210]);
    expect(gridRects(frame, { pattern: "rows", count: 2, gutter: 0 }).map(rect => [rect.y, rect.height])).toEqual([[0, 100], [100, 100]]);
    expect(gridRects({ x: 0, y: 0, width: 20, height: 10 }, { pattern: "grid", size: 10 })).toHaveLength(2);
    expect(gridLines(frame, [{ pattern: "columns", count: 2, gutter: 0 }, { pattern: "rows", count: 2, visible: false }])).toEqual({ x: [0, 200, 200, 400], y: [] });
  });
});
