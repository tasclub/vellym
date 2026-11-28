import { describe, expect, it } from "vitest";
import type { DesignNode } from "../packages/plugin-design/src/model/types.js";
import { indexBoard } from "../packages/plugin-design/src/edit/selection.js";
import { collect, duplicate, parseClipboard, paste, removeNodes, serialize } from "../packages/plugin-design/src/edit/clipboard.js";
import { alignMoves, distributeMoves } from "../packages/plugin-design/src/edit/align.js";

const root: DesignNode = { id: "root", type: "frame", width: 400, height: 400, children: [
  { id: "rectangle-1", type: "rectangle", x: 10, y: 10, width: 10, height: 10 },
  { id: "card", type: "frame", x: 100, y: 100, width: 100, height: 100, children: [
    { id: "button", type: "instance", component: "button", x: 5, y: 5 }
  ] }
] };
const ids = (tree: DesignNode, id = "root") => (indexBoard(tree).get(id)!.node as { children: DesignNode[] }).children.map(child => child.id);

describe("copy and paste", () => {
  it("collects selected subtrees once and round-trips through the clipboard text", () => {
    const found = collect(indexBoard(root), ["card", "button", "root"]);
    expect(found.nodes.map(node => node.id)).toEqual(["card"]);
    const text = serialize({ ...found, board: "board" });
    expect(parseClipboard(text)).toEqual({ ...found, board: "board" });
    expect(parseClipboard("plain words")).toBeUndefined();
    expect(parseClipboard('{"nodes":[]}')).toBeUndefined();
  });
  it("duplicates above the original with new ids, keeping instances pointing at their component", () => {
    const made = duplicate(root, ["card"], 10, 10);
    expect(ids(made.root)).toEqual(["rectangle-1", "card", "card-2"]);
    expect(made.ids).toEqual(["card-2"]);
    const copy = indexBoard(made.root).get("card-2")!.node as { x: number; children: DesignNode[] };
    expect(copy.x).toBe(110);
    expect(copy.children[0]).toMatchObject({ id: "button-2", type: "instance", component: "button", x: 5 });
  });
  it("pastes on top, offsetting only where the originals still sit, and into another frame", () => {
    const copied = { ...collect(indexBoard(root), ["rectangle-1"]), board: "board" };
    const same = paste(root, "root", copied, true);
    expect(ids(same.root)).toEqual(["rectangle-1", "card", "rectangle-2"]);
    expect(indexBoard(same.root).get("rectangle-2")!.node).toMatchObject({ x: 20, y: 20 });
    const into = paste(root, "card", copied, false);
    expect(ids(into.root, "card")).toEqual(["button", "rectangle-2"]);
    expect(indexBoard(into.root).get("rectangle-2")!.node).toMatchObject({ x: 10, y: 10 });
    expect(paste(root, "rectangle-1", copied, true).ids).toEqual([]);
  });
  it("removes nodes but never the board root", () => {
    expect(ids(removeNodes(root, ["rectangle-1", "root"]))).toEqual(["card"]);
  });
});

describe("align and distribute", () => {
  const boxes = new Map([["a", { x: 0, y: 0, width: 10, height: 10 }], ["b", { x: 50, y: 20, width: 20, height: 10 }], ["c", { x: 100, y: 5, width: 10, height: 30 }]]);
  it("aligns edges and centres to a frame", () => {
    const frame = { x: 0, y: 0, width: 110, height: 35 };
    expect(alignMoves(boxes, "left", frame)).toEqual(new Map([["b", { dx: -50, dy: 0 }], ["c", { dx: -100, dy: 0 }]]));
    expect(alignMoves(boxes, "bottom", frame).get("a")).toEqual({ dx: 0, dy: 25 });
    expect(alignMoves(boxes, "centerX", frame).get("b")).toEqual({ dx: -5, dy: 0 });
  });
  it("spaces three or more boxes evenly and keeps the ends", () => {
    // Total width 40 over 0..110: gaps of 35; b moves to 45.
    expect(distributeMoves(boxes, "x")).toEqual(new Map([["b", { dx: -5, dy: 0 }]]));
    expect(distributeMoves(new Map([...boxes].slice(0, 2)), "x").size).toBe(0);
  });
});
