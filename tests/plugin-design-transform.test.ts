import { describe, expect, it } from "vitest";
import type { DesignNode } from "../packages/plugin-design/src/model/types.js";
import { indexBoard } from "../packages/plugin-design/src/edit/selection.js";
import {
  movable, moveNodes, normalizeAngle, resizeBox, resizeNodes, resizable, rotateNodes, type WorldBox
} from "../packages/plugin-design/src/edit/transform.js";

const root = (): DesignNode => ({ id: "root", type: "frame", width: 400, height: 300, children: [
  { id: "a", type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
  { id: "b", type: "rectangle", x: 200, y: 20, width: 50, height: 50 },
  { id: "turned", type: "group", x: 50, y: 150, width: 100, height: 100, rotation: 90, children: [
    { id: "inside", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }
  ] },
  { id: "row", type: "frame", x: 0, y: 260, width: 200, height: 40, layout: { display: "flex" }, children: [
    { id: "flowing", type: "rectangle", width: 20, height: 20 },
    { id: "pinned", type: "rectangle", position: "absolute", x: 5, y: 5, width: 20, height: 20 }
  ] }
] });
const node = (tree: DesignNode, id: string) => indexBoard(tree).get(id)!.node;
const box = (cx: number, cy: number, width: number, height: number, rotation = 0): WorldBox => ({ cx, cy, width, height, rotation });

describe("which nodes move", () => {
  it("skips the board root, flex/grid flow children and nodes under a selected ancestor", () => {
    const index = indexBoard(root());
    expect(movable(index, ["root", "a", "flowing", "pinned", "turned", "inside"]).sort()).toEqual(["a", "pinned", "turned"]);
    expect(resizable(index, ["root"])).toEqual(["root"]);
    expect(resizable(index, ["root", "a"])).toEqual(["a"]);
  });
});

describe("move", () => {
  it("adds the world delta, rotated into the parent's axes, and keeps the root's identity when nothing moves", () => {
    const tree = root();
    const moved = moveNodes(tree, ["a", "inside"], 5, -3);
    expect(node(moved, "a")).toMatchObject({ x: 15, y: 17 });
    // The group is turned 90 degrees: a world move to the right is +y inside it.
    expect(node(moved, "inside")).toMatchObject({ x: -3, y: -5 });
    expect(node(moved, "b")).toBe(node(tree, "b"));
    expect(moveNodes(tree, ["flowing", "root"], 5, 5)).toBe(tree);
  });
});

describe("resize", () => {
  it("keeps the opposite corner, keeps the ratio with Shift and the centre with Alt", () => {
    expect(resizeBox(box(50, 25, 100, 50), "se", 20, 10, { keepRatio: false, fromCenter: false })).toMatchObject(box(60, 30, 120, 60));
    expect(resizeBox(box(50, 25, 100, 50), "e", 20, 99, { keepRatio: true, fromCenter: false })).toMatchObject({ width: 120, height: 60 });
    expect(resizeBox(box(50, 25, 100, 50), "nw", -10, -10, { keepRatio: false, fromCenter: true })).toMatchObject(box(50, 25, 120, 70));
    expect(resizeBox(box(50, 25, 100, 50), "w", 500, 0, { keepRatio: false, fromCenter: false }).width).toBe(1);
  });
  it("resizes a rotated box in its own axes", () => {
    // Turned 90 degrees, the box's own +x points down the screen.
    const turned = resizeBox(box(0, 0, 100, 50, 90), "e", 0, 20, { keepRatio: false, fromCenter: false });
    expect(turned).toMatchObject({ width: 120, height: 50 });
    expect(turned.cx).toBeCloseTo(0);
    expect(turned.cy).toBeCloseTo(10);
  });
  it("writes x, y, width and height for one node and scales several from their frame", () => {
    const tree = root();
    const single = resizeNodes(tree, new Map([["a", box(60, 45, 100, 50)]]), "nw", -10, -10, { keepRatio: false, fromCenter: false });
    expect(node(single, "a")).toMatchObject({ x: 0, y: 10, width: 110, height: 60 });
    const pair = resizeNodes(tree, new Map([["a", box(60, 45, 100, 50)], ["b", box(225, 45, 50, 50)]]), "e", 240, 0,
      { keepRatio: false, fromCenter: false });
    // Frame 10..250 (240 wide) doubles: a keeps its left edge, b moves out and doubles.
    expect(node(pair, "a")).toMatchObject({ x: 10, width: 200 });
    expect(node(pair, "b")).toMatchObject({ x: 390, width: 100 });
    const board = resizeNodes(tree, new Map([["root", box(200, 150, 400, 300)]]), "se", 10, 20, { keepRatio: false, fromCenter: false });
    expect(node(board, "root")).toMatchObject({ width: 410, height: 320 });
    expect(node(board, "root").x).toBeUndefined();
  });
});

describe("rotate", () => {
  it("adds the angle, snaps to 15 degrees with Shift and normalises", () => {
    const tree = root();
    expect(node(rotateNodes(tree, ["a"], 20, false, new Map()), "a").rotation).toBe(20);
    expect(node(rotateNodes(tree, ["a"], 20, true, new Map()), "a").rotation).toBe(15);
    expect(node(rotateNodes(tree, ["turned"], 100, false, new Map([["turned", 90]])), "turned").rotation).toBe(-170);
    expect(rotateNodes(tree, ["root"], 30, false, new Map())).toBe(tree);
    expect(normalizeAngle(-180)).toBe(180);
  });
});
