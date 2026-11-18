import { describe, expect, it } from "vitest";
import { resolveLocalizedText, summarizeRows, type PluginIndexRow } from "../packages/plugin-api/src/index.js";
import { summarizeColumn } from "../packages/plugin-kanban/src/summary.js";
import { ticketListView } from "../packages/plugin-tickets/src/views.js";

// ticket-01m7ppqw38radscvk7zrdchf7j: breakdowns show choice names in definition order everywhere.
const options = [{ value: "high", label: "高" }, { value: "mid", label: "中" }, { value: "low", label: "低" }];
const row = (name: string, priority: string | null, sprint: string | null): PluginIndexRow =>
  ({ name, title: name, values: { "field:priority": priority, "field:sprint": sprint } }) as unknown as PluginIndexRow;
const rows = [row("a", "low", "s1"), row("b", "high", "s1"), row("c", "mid", "s2"), row("d", "mid", null), row("e", "other", "s2")];

describe("summary breakdown labels", () => {
  it("names known choices in definition order and keeps unknown values last", () => {
    const result = summarizeRows(rows, "field:priority", "select", "breakdown", "ja", { valueLabels: options });
    expect(result.text).toBe("内訳: 高 1、中 2、低 1、other 1");
    expect(summarizeRows(rows, "field:priority", "select", "breakdown", "ja").text).toBe("内訳: high 1、low 1、mid 2、other 1");
  });

  it("gives the list, WBS and Kanban the same text", () => {
    const field = { id: "priority", label: "優先度", type: "select" as const, options, listColumn: true, filter: true, sort: true };
    const groupBy = { id: "sprint", label: "スプリント", type: "select" as const, options: [{ value: "s1", label: "第1" }, { value: "s2", label: "第2" }], listColumn: false, filter: false, sort: false };
    const kanban = summarizeColumn(rows, { field, method: "breakdown", groupBy } as never, "ja");
    // The list reads the descriptor the Tickets plugin builds.
    const tracker = { kind: "TicketTracker", name: "t", title: "T", relativePath: "t.yaml", readOnly: false,
      spec: { statuses: [{ id: "open", label: "Open", category: "open" }], fields: [
        { id: "priority", label: "優先度", type: "select", options, listColumn: true },
        { id: "sprint", label: "スプリント", type: "select", options: groupBy.options }
      ], summary: [{ field: "priority", method: "breakdown", groupBy: "sprint" }] } };
    const descriptor = ticketListView({ locale: "ja", isStatic: false, target: tracker, records: () => [tracker] } as never);
    const definition = descriptor.summary![0]!;
    const named = (items?: readonly { value: string; label: unknown }[]) => items?.map((item) => ({ value: item.value, label: resolveLocalizedText(item.label as string, "ja") }));
    const list = summarizeRows(rows, definition.valueKey, definition.type, definition.method, "ja", {
      valueLabels: named(definition.options),
      groupBy: { key: definition.groupBy!.valueKey, type: definition.groupBy!.type, order: definition.groupBy!.order, labels: named(definition.groupBy!.options) }
    });
    // WBS passes the tracker's own options, as the Kanban does.
    const wbs = summarizeRows(rows, "field:priority", "select", "breakdown", "ja", {
      valueLabels: options, groupBy: { key: "field:sprint", type: "select", order: ["s1", "s2"], labels: groupBy.options }
    });
    expect(kanban.text).toBe(`優先度 ${list.text}`);
    expect(wbs).toEqual(list);
    expect(list.groups?.map((group) => `${group.label}: ${group.text}`)).toEqual([
      "第1: 内訳: 高 1、低 1", "第2: 内訳: 中 1、other 1", "（未設定）: 内訳: 中 1"
    ]);
  });
});
