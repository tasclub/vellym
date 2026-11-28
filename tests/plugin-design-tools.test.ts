import { describe, expect, it } from "vitest";
import type { DesignNode } from "../packages/plugin-design/src/model/types.js";
import { indexBoard } from "../packages/plugin-design/src/edit/selection.js";
import {
  createNode, drawBounds, flows, imageNode, insertChild, newNodeId, parentFrame, toParent
} from "../packages/plugin-design/src/tools/shape-tools.js";

const plain = { square: false, fromCenter: false };
const root: DesignNode = { id: "root", type: "frame", width: 400, height: 400, children: [
  { id: "rectangle-1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
  { id: "card", type: "frame", x: 50, y: 50, width: 200, height: 200, children: [] },
  { id: "row", type: "frame", x: 0, y: 300, width: 300, height: 50, layout: { display: "flex" }, children: [] }
] };

describe("drawing", () => {
  it("normalises the dragged box, squares it with Shift and grows from the start with Alt", () => {
    expect(drawBounds("rectangle", { x: 50, y: 40 }, { x: 10, y: 10 }, plain)).toEqual({ x: 10, y: 10, width: 40, height: 30 });
    expect(drawBounds("ellipse", { x: 0, y: 0 }, { x: 30, y: 10 }, { square: true, fromCenter: false })).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    expect(drawBounds("rectangle", { x: 100, y: 100 }, { x: 110, y: 120 }, { square: false, fromCenter: true })).toEqual({ x: 90, y: 80, width: 20, height: 40 });
    // A line keeps its direction and snaps to 45-degree steps with Shift.
    expect(drawBounds("line", { x: 0, y: 0 }, { x: 40, y: -38 }, { square: true, fromCenter: false })).toMatchObject({ x: 0, y: 0 });
    const snapped = drawBounds("line", { x: 0, y: 0 }, { x: 40, y: -38 }, { square: true, fromCenter: false });
    expect(snapped.width).toBeCloseTo(-snapped.height);
  });
  it("creates each shape with defaults; an upward line is a turned horizontal line", () => {
    expect(createNode("polygon", "p", { x: 1, y: 2, width: 3, height: 4 }, true)).toMatchObject({ type: "polygon", pointCount: 3, x: 1, y: 2 });
    expect(createNode("star", "s", { x: 0, y: 0, width: 3, height: 4 }, true)).toMatchObject({ type: "star", pointCount: 5, innerRadius: 0.38 });
    expect(createNode("frame", "f", { x: 0, y: 0, width: 3, height: 4 }, false)).toEqual({ id: "f", type: "frame", width: 3, height: 4, fills: [{ color: "#ffffff" }], children: [] });
    expect(createNode("line", "l", { x: 0, y: 0, width: 30, height: -40 }, true)).toMatchObject({ type: "line", x: -10, y: -20, width: 50, height: 0, rotation: -53.13 });
  });
});

describe("placing", () => {
  it("picks the deepest unlocked frame, names ids uniquely and appends on top", () => {
    const index = indexBoard(root);
    expect(parentFrame(index, ["card", "root"])).toBe("card");
    expect(parentFrame(index, ["rectangle-1", "root"])).toBe("root");
    expect(newNodeId(index, "rectangle")).toBe("rectangle-2");
    expect(flows(index.get("row")!.node)).toBe(true);
    const next = insertChild(root, "card", { id: "x", type: "rectangle" });
    expect((indexBoard(next).get("card")!.node as { children: DesignNode[] }).children.map(child => child.id)).toEqual(["x"]);
    expect(insertChild(root, "rectangle-1", { id: "x", type: "rectangle" })).toBe(root);
  });
  it("converts a world box into a rotated parent's axes and keeps the shape upright", () => {
    const local = toParent({ x: 90, y: 40, width: 20, height: 20 }, { cx: 100, cy: 100, width: 200, height: 100, rotation: 90 });
    // Parent turned 90 degrees: screen-up is the parent's -x, so the box sits left of its centre.
    expect(local.x).toBeCloseTo(40);
    expect(local.y).toBeCloseTo(40);
    expect(local.rotation).toBe(-90);
  });
  it("caps images at 400 wide around the point", () => {
    expect(imageNode("image-1", "2026/11/a.png", { width: 800, height: 600 }, { x: 300, y: 200 }, "a.png"))
      .toEqual({ id: "image-1", type: "image", asset: "2026/11/a.png", fit: "fill", x: 100, y: 50, width: 400, height: 300, alt: "a.png" });
  });
});
