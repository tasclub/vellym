import { describe, expect, it } from "vitest";
import type { DesignNode } from "../packages/plugin-design/src/model/types.js";
import { indexBoard } from "../packages/plugin-design/src/edit/selection.js";
import { dropTarget, moveInto, moveOut, moveTo, reorder } from "../packages/plugin-design/src/edit/tree.js";

const root: DesignNode = { id: "root", type: "frame", width: 400, height: 400, children: [
  { id: "a", type: "rectangle", x: 10, y: 10, width: 10, height: 10 },
  { id: "card", type: "frame", x: 100, y: 50, width: 200, height: 200, children: [
    { id: "inner", type: "rectangle", x: 5, y: 6, width: 10, height: 10 }
  ] },
  { id: "b", type: "rectangle", x: 30, y: 30, width: 10, height: 10 }
] };
const order = (tree: DesignNode | undefined, id = "root") =>
  (indexBoard(tree!).get(id)!.node as { children: DesignNode[] }).children.map(child => child.id);
const node = (tree: DesignNode | undefined, id: string) => indexBoard(tree!).get(id)!.node;

describe("layer moves", () => {
  it("reorders one step up or down and refuses past the ends", () => {
    expect(order(reorder(root, "a", 1))).toEqual(["card", "a", "b"]);
    expect(order(reorder(root, "b", -1))).toEqual(["a", "b", "card"]);
    expect(reorder(root, "b", 1)).toBeUndefined();
    expect(reorder(root, "root", 1)).toBeUndefined();
  });
  it("moves out above the parent and into the container below, keeping the board position", () => {
    const out = moveOut(root, "inner");
    expect(order(out)).toEqual(["a", "card", "inner", "b"]);
    expect(node(out, "inner")).toMatchObject({ x: 105, y: 56 });
    const into = moveInto(root, "b");
    expect(order(into, "card")).toEqual(["inner", "b"]);
    expect(node(into, "b")).toMatchObject({ x: -70, y: -20 });
    expect(moveInto(root, "a")).toBeUndefined();
    expect(moveOut(root, "a")).toBeUndefined();
  });
  it("refuses moving a container into itself and maps drops above, below and inside", () => {
    expect(moveTo(root, "card", "card", 0)).toBeUndefined();
    const index = indexBoard(root);
    expect(dropTarget(index, "card", "above")).toEqual({ parentId: "root", position: 2 });
    expect(dropTarget(index, "card", "below")).toEqual({ parentId: "root", position: 1 });
    expect(dropTarget(index, "card", "inside")).toEqual({ parentId: "card", position: 1 });
    expect(dropTarget(index, "a", "inside")).toBeUndefined();
    expect(order(moveTo(root, "a", "root", 3))).toEqual(["card", "b", "a"]);
  });
});
