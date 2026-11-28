import { describe, expect, it } from "vitest";
import { children, indexBoard, parents, pickAt, prune, selectable } from "../packages/plugin-design/src/edit/selection.js";
import type { DesignNode } from "../packages/plugin-design/src/model/types.js";

const root: DesignNode = { id: "root", type: "frame", children: [
  { id: "group", type: "group", children: [
    { id: "inner", type: "group", children: [{ id: "leaf", type: "rectangle" }] },
    { id: "peer", type: "rectangle" }
  ] },
  { id: "other", type: "rectangle" },
  { id: "locked", type: "group", locked: true, children: [{ id: "locked-child", type: "rectangle" }] },
  { id: "hidden", type: "group", visible: false, children: [{ id: "hidden-child", type: "rectangle" }] }
] };
const index = indexBoard(root);
const chain = ["leaf", "inner", "group", "root"];
describe("design selection", () => {
  it("indexes parent and depth without modifying the tree", () => {
    expect(index.get("leaf")).toMatchObject({ parentId: "inner", depth: 3 });
    expect(index.get("root")?.parentId).toBeUndefined();
  });
  it("picks outside-in, then peers at the selected depth", () => {
    expect(pickAt(index, chain, [], "normal")).toBe("group");
    expect(pickAt(index, chain, ["peer"], "normal")).toBe("inner");
    expect(pickAt(index, ["root"], [], "normal")).toBe("root");
    expect(pickAt(index, [], [], "normal")).toBeUndefined();
  });
  it("deep picks the leaf and enter steps inside the selected ancestor", () => {
    expect(pickAt(index, chain, [], "deep")).toBe("leaf");
    expect(pickAt(index, chain, ["group"], "enter")).toBe("inner");
    expect(pickAt(index, chain, ["leaf"], "enter")).toBe("leaf");
    expect(pickAt(index, chain, ["other"], "enter")).toBe("group");
  });
  it("enters eligible immediate children and keeps leaves", () => {
    expect(children(index, ["group"])).toEqual(["inner", "peer"]);
    expect(children(index, ["root"])).toEqual(["group", "other"]);
    expect(children(index, ["leaf"])).toEqual(["leaf"]);
  });
  it("deduplicates parents and keeps the root", () => {
    expect(parents(index, ["inner", "peer"])).toEqual(["group"]);
    expect(parents(index, ["root"])).toEqual(["root"]);
  });
  it("rejects blocked nodes and their descendants, and prunes vanished ids", () => {
    for (const id of ["locked", "locked-child", "hidden", "hidden-child", "gone"]) {
      expect(selectable(index, id)).toBe(false);
      for (const mode of ["normal", "deep", "enter"] as const)
        expect(pickAt(index, [id, "root"], [], mode)).toBeUndefined();
    }
    expect(prune(index, ["gone", "locked-child", "leaf", "leaf", "hidden"])).toEqual(["leaf"]);
    expect(prune(indexBoard({ id: "root", type: "frame", children: [] }), ["leaf"])).toEqual([]);
  });
});
