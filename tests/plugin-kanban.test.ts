import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  PluginIndexRow,
  PluginResourceRecord,
  PluginViewContext,
  VellymPluginHost
} from "@vellym/plugin-api";
import { resolveLocalizedText } from "@vellym/plugin-api";
import { validatePluginManifest } from "@vellym-internal/core";
import { TICKET_ENGINE_VERSION } from "@vellym-internal/ticket-engine";
import plugin from "@vellym/kanban";
import { kanbanView, resolveKanbanDefinition } from "../packages/plugin-kanban/src/board.js";
import { buildKanbanColumns } from "../packages/plugin-kanban/src/model.js";

function record(
  kind: string,
  name: string,
  relativePath: string,
  spec: Record<string, unknown> = {}
): PluginResourceRecord {
  return { kind, name, title: name, relativePath, spec, readOnly: false };
}

const tracker = record("TicketTracker", "quality-tickets", "40-品質/quality-tickets.yaml", {
  statuses: [
    { id: "todo", label: "未着手", category: "open" },
    { id: "doing", label: "対応中", category: "open" },
    { id: "done", label: "完了", category: "closed" }
  ]
});
function context(target = tracker, definitions: PluginResourceRecord[] = [tracker]): PluginViewContext {
  return {
    locale: "ja",
    isStatic: false,
    target,
    records: (kind) => definitions.filter((item) => item.kind === kind)
  };
}

function activate() {
  const kinds = new Map<string, Parameters<VellymPluginHost["registerKind"]>[0]>();
  const views = new Map<string, Parameters<VellymPluginHost["registerView"]>[0]>();
  const projections = new Map<
    string,
    Parameters<VellymPluginHost["registerRecordProjection"]>[1]
  >();
  const commands: Parameters<VellymPluginHost["registerCommand"]>[0][] = [];
  plugin.activate({
    pluginId: "kanban",
    hostVersion: "0.4.0-beta",
    registerKind: (value) => kinds.set(value.kind, value),
    registerView: (value) => views.set(value.id, value),
    registerCommand: (value) => commands.push(value),
    registerRecordProjection: (kind, value) => projections.set(kind, value),
    registerRecordSetValidator: () => {},
    registerFileKind: () => {}, registerFileSetValidator: () => {},
    reportDiagnostic: () => {}
  });
  return { kinds, views, projections, commands };
}

function row(name: string, status?: string): PluginIndexRow {
  return {
    name,
    title: name,
    values: status === undefined ? { status: "" } : { status }
  };
}

describe("Kanban plugin", () => {
  it("ships a valid list-view manifest without adding a view type", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "packages/plugin-kanban/package.json"), "utf8")
    ).vellym;
    expect(validatePluginManifest(manifest).errors).toEqual([]);
    expect(manifest.contributes.views).toEqual([
      expect.objectContaining({ id: "ticket-kanban", type: "list", opensKind: "TicketTracker" })
    ]);
    expect(manifest.contributes.kinds.map((item: { kind: string }) => item.kind)).not.toContain("KanbanBoard");
  });

  it("bundles and registers the ticket engine for standalone use", () => {
    const { kinds, projections, commands } = activate();
    expect(kinds.get("Ticket")?.engineVersion).toBe(TICKET_ENGINE_VERSION);
    expect(kinds.get("TicketTracker")?.engineVersion).toBe(TICKET_ENGINE_VERSION);
    expect(kinds.has("KanbanBoard")).toBe(false);
    expect(projections.has("Ticket")).toBe(true);
    expect(commands.map((command) => command.id)).toContain("ticket.create-tracker");
    expect(commands.map((command) => command.id)).toContain("ticket.create");
  });

  it("uses the opened Tracker as the board source and status definition", () => {
    const descriptor = kanbanView(context());
    expect(descriptor.paperWidth).toBe("full");
    expect(descriptor.scopeFilters).toEqual([
      { columnId: "trackers", operator: "contains", value: "quality-tickets" }
    ]);
    expect(descriptor.rendererData).toMatchObject({
      statuses: [
        { id: "todo", label: "未着手" },
        { id: "doing", label: "対応中" },
        { id: "done", label: "完了" }
      ],
      diagnostics: []
    });
  });

  it("keeps Tracker status order, empty columns, unset, and unknown statuses", () => {
    const data = resolveKanbanDefinition(context());
    const columns = buildKanbanColumns(
      data,
      [row("doing-ticket", "doing"), row("unset-ticket"), row("legacy-ticket", "legacy")],
      "ja"
    );
    expect(columns.map(({ id, label, kind, rows }) => ({
      id,
      label,
      kind,
      names: rows.map((item) => item.name)
    }))).toEqual([
      { id: "todo", label: "未着手", kind: "defined", names: [] },
      { id: "doing", label: "対応中", kind: "defined", names: ["doing-ticket"] },
      { id: "done", label: "完了", kind: "defined", names: [] },
      { id: "", label: { ja: "未設定", en: "Unset" }, kind: "unset", names: ["unset-ticket"] },
      { id: "legacy", label: { ja: "定義外: legacy", en: "Unknown: legacy" }, kind: "unknown", names: ["legacy-ticket"] }
    ]);
  });

  it("diagnoses a missing opened Tracker without throwing", () => {
    const invalid = record("Ticket", "some-ticket", "tickets/some-ticket.yaml");
    const [diagnostic] = resolveKanbanDefinition(context(invalid, [])).diagnostics;
    expect(diagnostic?.code).toBe("KANBAN_TRACKER_UNRESOLVED");
    expect(resolveLocalizedText(diagnostic!.message, "ja"))
      .toBe("このチケット管理のステータスの定義を読み込めません");
    expect(resolveLocalizedText(diagnostic!.message, "en"))
      .toBe("Could not resolve the opened TicketTracker status definitions.");
    expect(resolveKanbanDefinition(context(invalid, [])).diagnostics.map((item) => item.code)).toEqual([
      "KANBAN_TRACKER_UNRESOLVED"
    ]);
    expect(() => kanbanView(context(invalid, []))).not.toThrow();
  });

  it("reads card fields from the tracker, skips undefined fields and warns about malformed configuration", () => {
    const configured = record("TicketTracker", "quality-tickets", tracker.relativePath, {
      ...tracker.spec,
      fields: [
        { id: "priority", label: "優先度", type: "select", options: [{ value: "high", label: "高" }] },
        { id: "due", label: "期限", type: "date" }
      ],
      kanban: { card: ["priority", "missing", "due", "priority"] }
    });
    const result = resolveKanbanDefinition(context(configured, [configured]));
    expect(result.cardFields.map((field) => field.id)).toEqual(["priority", "due"]);
    expect(result.diagnostics.map((item) => item.code)).toContain("KANBAN_CARD_FIELD_UNDEFINED");
    const invalid = record("TicketTracker", "quality-tickets", tracker.relativePath, {
      ...tracker.spec, kanban: { card: "priority" }
    });
    expect(resolveKanbanDefinition(context(invalid, [invalid])).cardFields).toEqual([]);
    expect(resolveKanbanDefinition(context(invalid, [invalid])).diagnostics.map((item) => item.code))
      .toContain("KANBAN_CARD_INVALID");
  });

  it("accepts only summary methods supported by the declared field type", () => {
    const configured = record("TicketTracker", "quality-tickets", tracker.relativePath, {
      ...tracker.spec,
      fields: [{ id: "estimate", label: "見積", type: "number" }],
      kanban: { summary: [
        { field: "estimate", method: "sum" },
        { field: "estimate", method: "earliest" },
        { field: "missing", method: "count" }
      ] }
    });
    const result = resolveKanbanDefinition(context(configured, [configured]));
    expect(result.summaries.map(({ field, method }) => [field.id, method])).toEqual([["estimate", "sum"]]);
    expect(result.diagnostics.filter((item) => item.code === "KANBAN_SUMMARY_UNSUPPORTED")).toHaveLength(2);
  });

  it("uses only a tracker-defined number field for manual order", () => {
    const configured = record("TicketTracker", "quality-tickets", tracker.relativePath, {
      ...tracker.spec,
      fields: [{ id: "rank", label: "順序", type: "number" }],
      kanban: { orderField: "rank" }
    });
    expect(resolveKanbanDefinition(context(configured, [configured])).orderField?.id).toBe("rank");
    const bad = record("TicketTracker", "quality-tickets", tracker.relativePath, {
      ...tracker.spec, kanban: { orderField: "rank" }
    });
    const result = resolveKanbanDefinition(context(bad, [bad]));
    expect(result.orderField).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("KANBAN_ORDER_FIELD_INVALID");
  });
});
