import { describe, expect, it } from "vitest";
import type { PluginDetailViewDescriptor } from "@vellym/plugin-api";
import { referencedByOf, type PluginViewRow } from "../packages/runtime-node/src/plugins.js";

// ticket-01m7k6gftq6gt6j226dsbz5yq0: reverse references from index rows, without knowing the kind.
const descriptor: PluginDetailViewDescriptor = {
  type: "detail",
  id: "item.detail",
  kind: "Item",
  body: "none",
  referencedBy: { statusField: "state" },
  fields: [
    { id: "state", label: { ja: "状態", en: "State" }, type: "select", path: ["state"], valueKey: "state",
      options: [{ value: "open", label: { ja: "未対応", en: "Open" } }] },
    { id: "parent", label: { ja: "親", en: "Parent" }, type: "reference", path: ["fields", "parent"], valueKey: "field:parent" },
    { id: "blocks", label: { ja: "依存", en: "Depends on" }, type: "reference", multiple: true, path: ["fields", "blocks"], valueKey: "field:blocks" },
    { id: "note", label: "Note", type: "text", path: ["fields", "note"], valueKey: "field:note" }
  ]
};
const row = (name: string, title: string, values: Record<string, unknown>): PluginViewRow =>
  ({ name, title, relativePath: `${name}.yaml`, values }) as unknown as PluginViewRow;
const target = row("t", "Target", { "field:parent": "t" });

describe("referencedByOf", () => {
  it("finds single and multiple references with their state, skips itself and other fields", () => {
    const rows = [
      target,
      row("b", "Beta", { state: "open", "field:parent": "t" }),
      row("a", "Alpha", { state: "unknown", "field:blocks": ["x", "t"] }),
      row("c", "Gamma", { "field:note": "t" }),
      row("d", "Delta", { "field:parent": "other" })
    ];
    expect(referencedByOf(descriptor, target, rows, "en")).toEqual([
      { name: "a", title: "Alpha", fieldId: "blocks", fieldLabel: { ja: "依存", en: "Depends on" }, status: "unknown" },
      { name: "b", title: "Beta", fieldId: "parent", fieldLabel: { ja: "親", en: "Parent" }, status: "open", statusLabel: { ja: "未対応", en: "Open" } }
    ]);
  });

  it("follows edits and deletions because it is computed from the current rows", () => {
    const before = [target, row("b", "Beta", { "field:parent": "t" })];
    expect(referencedByOf(descriptor, target, before, "en")).toHaveLength(1);
    expect(referencedByOf(descriptor, target, [target, row("b", "Beta", { "field:parent": "" })], "en")).toEqual([]);
    expect(referencedByOf(descriptor, target, [target], "en")).toEqual([]);
  });
});
