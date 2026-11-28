import { describe, expect, it } from "vitest";
import { evaluate } from "../packages/plugin-design/src/panels/fields/expression.js";
import { MIXED } from "../packages/plugin-design/src/panels/fields/number-field.js";
import { inspectorSections, registerSection, shared, type InspectorTarget } from "../packages/plugin-design/src/panels/sections.js";
import { indexBoard } from "../packages/plugin-design/src/edit/selection.js";

describe("typed numbers", () => {
  it("evaluates arithmetic without eval and rejects anything else", () => {
    expect(evaluate("16*2")).toBe(32);
    expect(evaluate("(100 - 8) / 2")).toBe(46);
    expect(evaluate("-3+1.5")).toBe(-1.5);
    expect(evaluate("1,5*2")).toBe(3);
    expect(evaluate("10/3")).toBe(3.33);
    for (const bad of ["", "2*", "(1", "alert(1)", "1/0", "2**3", "1e999"]) expect(evaluate(bad), bad).toBeUndefined();
  });
});

describe("sections", () => {
  const root = { id: "root", type: "frame", width: 100, height: 100, children: [
    { id: "a", type: "rectangle", x: 1, width: 10, height: 10 }, { id: "b", type: "rectangle", x: 2, width: 10, height: 10 }
  ] } as const;
  const index = indexBoard(root as never);
  const target = (id: string): InspectorTarget => ({ board: "board", node: index.get(id)!.node, index });
  it("reports one shared value or mixed", () => {
    expect(shared([target("a"), target("b")], node => node.width)).toBe(10);
    expect(shared([target("a"), target("b")], node => node.x)).toBe(MIXED);
  });
  it("keeps the built-in order and lets other panels add or replace sections", () => {
    expect(inspectorSections.map(section => section.id)).toEqual(["position", "layer", "radius", "boards"]);
    registerSection({ id: "extra", tab: "code", when: () => true, render: () => null });
    registerSection({ id: "extra", tab: "prototype", when: () => true, render: () => null });
    expect(inspectorSections.filter(section => section.id === "extra").map(section => section.tab)).toEqual(["prototype"]);
    inspectorSections.splice(inspectorSections.findIndex(section => section.id === "extra"), 1);
  });
});
