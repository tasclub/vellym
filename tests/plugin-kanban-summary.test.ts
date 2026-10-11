import { describe, expect, it } from "vitest";
import type { PluginIndexRow } from "@vellym/plugin-api";
import type { FieldDefinition } from "@vellym-internal/ticket-engine";
import { summarizeColumn } from "../packages/plugin-kanban/src/summary.js";

const field = (type: FieldDefinition["type"]): FieldDefinition => ({
  id: "value", label: "値", type, required: false, listColumn: false
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
