import { describe, expect, it } from "vitest";
import type { PluginIndexRow } from "@vellym/plugin-api";
import type { FieldDefinition } from "@vellym-internal/ticket-engine";
import { fieldKey } from "@vellym-internal/ticket-engine";
import { filterKanbanRows } from "../packages/plugin-kanban/src/filters.js";

const fields: FieldDefinition[] = [
  {
    id: "priority", label: "Priority", type: "select", required: false, listColumn: true,
    options: [{ value: "high", label: "High" }, { value: "low", label: "Low" }]
  },
  { id: "assignee", label: "Assignee", type: "text", required: false, listColumn: true },
  { id: "tags", label: "Tags", type: "multiselect", required: false, listColumn: true }
];

const rows: PluginIndexRow[] = [
  { name: "one", title: "One", values: {
    [fieldKey("priority")]: "high", [fieldKey("assignee")]: "Alice", [fieldKey("tags")]: ["urgent", "frontend"]
  } },
  { name: "two", title: "Two", values: {
    [fieldKey("priority")]: "low", [fieldKey("assignee")]: "Bob", [fieldKey("tags")]: ["backend"]
  } },
  { name: "three", title: "Three", values: {
    [fieldKey("priority")]: "low", [fieldKey("assignee")]: "ALICE", [fieldKey("tags")]: ["urgent"]
  } }
];

describe("Kanban filters", () => {
  it("matches select and multiselect values exactly and text case-insensitively", () => {
    expect(filterKanbanRows(rows, fields, { priority: "high" }).map((row) => row.name))
      .toEqual(["one"]);
    expect(filterKanbanRows(rows, fields, { assignee: "ali" }).map((row) => row.name))
      .toEqual(["one", "three"]);
    expect(filterKanbanRows(rows, fields, { tags: "urgent" }).map((row) => row.name))
      .toEqual(["one", "three"]);
  });

  it("applies multiple filters together and leaves rows unchanged with no active filters", () => {
    expect(filterKanbanRows(rows, fields, { priority: "low", assignee: "ali" }).map((row) => row.name))
      .toEqual(["three"]);
    expect(filterKanbanRows(rows, fields, {}).map((row) => row.name))
      .toEqual(["one", "two", "three"]);
  });
});
