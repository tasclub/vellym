import { describe, expect, it } from "vitest";
import type { KanbanColumn } from "../packages/plugin-kanban/src/model.js";
import {
  columnKey,
  readColumnSettings,
  selectableColumns,
  selectedColumnKeys,
  toggleColumn
} from "../packages/plugin-kanban/src/column-settings.js";

const columns: KanbanColumn[] = [
  { kind: "defined", id: "todo", label: "Todo", rows: [] },
  { kind: "defined", id: "done", label: "Done", rows: [] }
];

describe("Kanban column preferences", () => {
  it("scopes column selection to each tracker without importing the old global hidden setting", () => {
    const stored = readColumnSettings({
      collapsed: ["defined:todo"],
      hidden: ["defined:done"],
      trackerA: { columns: ["defined:todo"], knownColumns: ["defined:todo", "defined:done"] }
    });
    expect(stored).toEqual({
      trackerA: { columns: ["defined:todo"], knownColumns: ["defined:todo", "defined:done"] }
    });
    expect(selectedColumnKeys(columns, stored.trackerA).has("defined:done")).toBe(false);
    expect(selectedColumnKeys(columns, stored.trackerB).has("defined:done")).toBe(true);
  });

  it("retains the personal sort when a column is toggled", () => {
    const stored = { columns: ["defined:todo"], knownColumns: ["defined:todo", "defined:done"],
      sort: { field: "title", direction: "desc" as const } };
    expect(toggleColumn(columns, stored, "defined:done").sort).toEqual(stored.sort);
  });

  it("shows newly defined columns after a selection is saved", () => {
    const stored = { columns: ["defined:todo"], knownColumns: ["defined:todo", "defined:done"] };
    const next = [...columns, { kind: "defined" as const, id: "review", label: "Review", rows: [] }];
    expect(selectedColumnKeys(next, stored).has("defined:review")).toBe(true);
  });

  it("keeps special columns in the chooser after their last ticket disappears", () => {
    const stored = {
      columns: ["defined:todo", "defined:done"],
      knownColumns: ["defined:todo", "defined:done", "unset:", "unknown:legacy"]
    };
    const options = selectableColumns(columns, stored);
    expect(options.map(columnKey)).toEqual([
      "defined:todo", "defined:done", "unset:", "unknown:legacy"
    ]);
    expect(selectedColumnKeys(options, stored).has("unset:")).toBe(false);
    const restored = toggleColumn(options, stored, "unset:");
    expect(selectedColumnKeys(options, restored).has("unset:")).toBe(true);
  });
});
