import { describe, expect, it } from "vitest";
import type { PluginIndexRow } from "@vellym/plugin-api";
import type { FieldDefinition } from "@vellym-internal/ticket-engine";
import { summarizeColumn } from "../packages/plugin-kanban/src/summary.js";

const field = (type: FieldDefinition["type"]): FieldDefinition => ({
  id: "value", label: "値", type, required: false, listColumn: false, filter: false, sort: false, multiple: false
});
const rows = (values: unknown[]): PluginIndexRow[] => values.map((value, index) => ({
  name: String(index), title: String(index), values: { "field:value": value as string }
}));

describe("Kanban summaries", () => {
  it("skips missing and mismatched values while reporting excluded records", () => {
    const result = summarizeColumn(rows([10, null, 20, "bad"]), { field: field("number"), method: "sum" }, "ja");
    expect(result).toEqual({ text: "値 合計: 30", excluded: 1 });
    expect(summarizeColumn(rows([10, 20, 30]), { field: field("number"), method: "average" }, "ja").text)
      .toBe("値 平均: 20");
  });

  it("compares date-only strings, counts boolean values and breaks down categories", () => {
    expect(summarizeColumn(rows(["2026-10-05", "2026-10-01"]),
      { field: field("date"), method: "earliest" }, "ja").text).toBe("値 最早: 2026-10-01");
    expect(summarizeColumn(rows([true, false, true]),
      { field: field("boolean"), method: "false" }, "ja").text).toBe("値 偽: 1");
    expect(summarizeColumn(rows([["a", "b"], ["a"]]),
      { field: field("multiselect"), method: "breakdown" }, "ja").text).toBe("値 内訳: a 2、b 1");
  });

  it("uses a non-empty localized fallback for an unsupported locale", () => {
    expect(summarizeColumn(rows([true]), { field: field("boolean"), method: "true" }, "fr").text)
      .toBe("値 True: 1");
  });
});

import { summarizeRows, SUMMARY_METHODS, type PluginResourceRecord, type PluginViewContext } from "@vellym/plugin-api";
import { trackerDefinitionDiagnostics, readTrackers } from "../packages/ticket-engine/src/definitions.js";
import { resolveKanbanDefinition } from "../packages/plugin-kanban/src/board.js";

describe("shared summaries", () => {
  it("groups in defined order, counts multiselect in each group, and resolves references", () => {
    const data: PluginIndexRow[] = [
      { name: "a", title: "Alpha", values: { v: 2, g: ["b", "a"] } },
      { name: "b", title: "Beta", values: { v: 3, g: ["a"] } },
      { name: "c", title: "C", values: { v: 4, g: [] } }
    ];
    const result = summarizeRows(data, "v", "number", "sum", "en", { groupBy: { key: "g", type: "multiselect", order: ["b", "a"] } });
    expect(result.multiCounted).toBe(true);
    expect(result.groups?.map(g => [g.label, g.text])).toEqual([["b", "Sum: 2"], ["a", "Sum: 5"], ["(Not set)", "Sum: 4"]]);
    const refs = [{ name: "x", title: "X", values: { v: 1, g: "a" } }];
    expect(summarizeRows(refs, "v", "number", "sum", "ja", { groupBy: { key: "g", type: "reference", labelOf: v => data.find(r => r.name === v)?.title ?? v } }).groups?.[0]?.label).toBe("Alpha");
  });
  it("warns for undefined and unsupported group fields", () => {
    const target = record({ fields: [{ id: "value", type: "number" }], summary: [{ field: "value", method: "sum", groupBy: "missing" }, { field: "value", method: "sum", groupBy: "value" }] });
    expect(trackerDefinitionDiagnostics([target]).map(d => d.code)).toEqual(["TICKET_SUMMARY_UNSUPPORTED", "TICKET_SUMMARY_UNSUPPORTED"]);
  });
  const spec = { fields: [{ id: "value", label: "Value", type: "number" }], summary: [{ field: "value", method: "sum" }] };
  const record = (s: Record<string, unknown>): PluginResourceRecord => ({ kind: "TicketTracker", name: "t", title: "T", relativePath: "t.yaml", readOnly: false, spec: s });
  const context = (target: PluginResourceRecord): PluginViewContext => ({ locale: "en", isStatic: false, target, records: () => [target] });
  it("exposes pure calculations and skips invalid values", () => {
    expect(SUMMARY_METHODS.number).toContain("sum");
    expect(summarizeRows(rows([1, 2, "bad"]), "field:value", "number", "sum", "en")).toEqual({ text: "Sum: 3", excluded: 1 });
  });
  it("reads and diagnoses shared definitions", () => {
    expect(readTrackers(context(record(spec)))[0]?.summary?.[0]?.method).toBe("sum");
    const diagnostics = trackerDefinitionDiagnostics([record({ ...spec, summary: [{ field: "missing", method: "sum" }, { field: "value", method: "true" }] })]);
    expect(diagnostics.map(d => d.code)).toEqual(["TICKET_SUMMARY_UNSUPPORTED", "TICKET_SUMMARY_UNSUPPORTED"]);
    expect(diagnostics[0]?.message).toMatchObject({ ja: expect.any(String), en: expect.any(String) });
  });
  it("prefers even an empty Kanban summary and otherwise falls back to the shared one", () => {
    expect(resolveKanbanDefinition(context(record(spec))).summaries[0]?.method).toBe("sum");
    expect(resolveKanbanDefinition(context(record({ ...spec, kanban: { summary: [{ field: "value", method: "max" }] } }))).summaries[0]?.method).toBe("max");
    expect(resolveKanbanDefinition(context(record({ ...spec, kanban: { summary: [] } }))).summaries).toEqual([]);
    expect(resolveKanbanDefinition(context(record({ fields: spec.fields, kanban: { summary: [{ field: "value", method: "sum" }] } }))).summaries[0]?.method).toBe("sum");
  });
});
