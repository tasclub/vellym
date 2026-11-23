import { describe, expect, it } from "vitest";
import type { PluginIndexRow } from "@vellym/plugin-api";
import { neighboringRank, sortKanbanRows } from "../packages/plugin-kanban/src/order.js";

const rows: PluginIndexRow[] = [
  { name: "c", title: "C", values: { "field:order": 2, "field:due": "2026-10-04" } },
  { name: "a", title: "A", values: { "field:due": "2026-10-03" } },
  { name: "b", title: "B", values: { "field:order": 1 } },
  { name: "d", title: "D", values: { "field:order": 2 } }
];

describe("Kanban ordering", () => {
  it("puts unset ranks last and breaks ties with an immutable ID", () => {
    expect(sortKanbanRows(rows, { field: "field:order", direction: "asc" }, "ja").map((row) => row.name))
      .toEqual(["b", "c", "d", "a"]);
    expect(sortKanbanRows(rows, { field: "field:order", direction: "desc" }, "ja").map((row) => row.name))
      .toEqual(["c", "d", "b", "a"]);
  });

  it("sorts a date field without dropping unset rows", () => {
    expect(sortKanbanRows(rows, { field: "field:due", direction: "asc" }, "ja").map((row) => row.name))
      .toEqual(["a", "c", "b", "d"]);
  });

  it("calculates a rank for only the moved card, or requests explicit renumbering", () => {
    const sorted = sortKanbanRows(rows.filter((row) => row.name !== "a").map((row) => row.name === "d"
      ? { ...row, values: { ...row.values, "field:order": 4 } } : row),
    { field: "field:order", direction: "asc" }, "ja");
    expect(neighboringRank(sorted, 0, 1, "field:order")).toBe(3);
    expect(neighboringRank(sorted, 2, -1, "field:order")).toBe(1.5);
    expect(neighboringRank([
      { name: "a", title: "A", values: {} },
      { name: "b", title: "B", values: {} }
    ], 0, 1, "field:order")).toBeUndefined();
  });
});
