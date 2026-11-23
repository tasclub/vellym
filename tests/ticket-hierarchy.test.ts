import { describe, expect, it } from "vitest";
import type { PluginIndexRow, PluginResourceRecord } from "@vellym/plugin-api";
import { buildTicketHierarchy, readTrackers, trackerDefinitionDiagnostics } from "../packages/ticket-engine/src/index.js";

const definition: PluginResourceRecord = {
  kind: "TicketTracker", name: "tracker", title: "Tracker", relativePath: "tracker.yaml",
  readOnly: false,
  spec: { fields: [{ id: "parent", type: "reference" }], hierarchy: { parentField: "parent" } }
};
const tracker = readTrackers({ records: () => [definition] })[0]!;
const row = (name: string, parent?: string): PluginIndexRow => ({
  name, title: name, values: parent ? { "field:parent": parent } : {}
});

describe("Tracker-declared parent field", () => {
  it("builds an arbitrary-depth hierarchy without a fixed Ticket.spec.parent", () => {
    const entries = Array.from({ length: 2500 }, (_, index) => row(String(index), index ? String(index - 1) : undefined));
    const result = buildTicketHierarchy(tracker, entries);
    expect(result.diagnostics).toEqual([]);
    let current = result.roots[0];
    let depth = 0;
    while (current) { depth++; current = current.children[0]; }
    expect(depth).toBe(2500);
  });

  it("keeps missing parents and cycle members visible with diagnostics", () => {
    const result = buildTicketHierarchy(tracker, [row("orphan", "missing"), row("a", "b"),
      row("b", "a"), row("child", "a")]);
    expect(result.roots.map((node) => node.row.name)).toEqual(["orphan", "a", "b"]);
    expect(result.roots[1]?.children.map((node) => node.row.name)).toEqual(["child"]);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "TICKET_PARENT_UNRESOLVED", "TICKET_PARENT_CYCLE", "TICKET_PARENT_CYCLE"
    ]);
  });

  it("does not interpret undeclared or wrongly typed parent fields", () => {
    const invalid: PluginResourceRecord = {
      ...definition,
      spec: { fields: [{ id: "parent", type: "text" }], hierarchy: { parentField: "parent" } }
    };
    const parsed = readTrackers({ records: () => [invalid] })[0]!;
    expect(parsed.parentField).toBeUndefined();
    expect(trackerDefinitionDiagnostics([invalid]).map((item) => item.code))
      .toContain("TICKET_PARENT_FIELD_INVALID");
    expect(buildTicketHierarchy(parsed, [row("a", "b"), row("b", "a")]).roots).toHaveLength(2);
  });
});
