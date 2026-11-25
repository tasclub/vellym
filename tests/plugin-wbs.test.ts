import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PluginDiagnostic, PluginIndexRow, PluginResourceRecord, PluginViewContext, VellymPluginHost } from "@vellym/plugin-api";
import { resolveLocalizedText } from "@vellym/plugin-api";
import type { TicketTreeNode } from "../packages/ticket-engine/src/hierarchy.js";
import { validatePluginManifest } from "@vellym-internal/core";
import plugin from "../packages/plugin-wbs/src/node.js";
import { excludedParents, indentTarget, outdentTarget, rankForAppend, rankForInsert, flattenRows, rowWindow, rankForMove, sortedSiblings } from "../packages/plugin-wbs/src/model.js";
import { wbsView } from "../packages/plugin-wbs/src/view.js";
import { createTicketCommand } from "../packages/ticket-engine/src/commands.js";

const tracker: PluginResourceRecord = {
  kind: "TicketTracker", name: "project", title: "計画", relativePath: "plan.yaml", readOnly: false,
  spec: {
    statuses: [{ id: "todo", label: "未着手", category: "open" }],
    fields: [
      { id: "parent", label: "親", type: "reference" },
      { id: "start", label: "開始", type: "date" },
      { id: "due", label: "終了", type: "date" },
      { id: "sequence", label: "順序", type: "number" }
    ],
    hierarchy: { parentField: "parent" },
    wbs: { startField: "start", endField: "due", orderField: "sequence" }
  }
};
const context = (target = tracker): PluginViewContext => ({ locale: "ja", isStatic: false, target,
  records: (kind) => kind === "TicketTracker" ? [target] : [] });

describe("WBS as a TicketTracker view", () => {
  it("flattens sorted hierarchies and folds children without dropping the parent", () => {
    const child: TicketTreeNode = { row: { name: "child", title: "Child", values: {} }, children: [] };
    const parent: TicketTreeNode = { row: { name: "parent", title: "Parent", values: {} }, children: [child] };
    expect(flattenRows([parent], undefined, "en", new Set()).map((item) => [item.node.row.name, item.depth]))
      .toEqual([["parent", 0], ["child", 1]]);
    expect(flattenRows([parent], undefined, "en", new Set(["parent"])).map((item) => item.node.row.name))
      .toEqual(["parent"]);
  });
  it("windows only vertically with exactly ten overscan rows on either side", () => {
    expect(rowWindow(200, "virtual", 36 * 50, 36 * 10, 36, 100)).toEqual({ start: 40, end: 70 });
    expect(rowWindow(200, "virtual", 44 * 50, 44 * 10, 44, 100)).toEqual({ start: 40, end: 70 });
    expect(rowWindow(5, "virtual", 0, 360, 36, 100)).toEqual({ start: 0, end: 5 });
    expect(rowWindow(200, "all", 1800, 360, 36, 100)).toEqual({ start: 0, end: 200 });
    expect(rowWindow(200, "incremental", 1800, 360, 36, 100)).toEqual({ start: 0, end: 100 });
  });
  it("keeps the name and date header sticky and switches columns only in CSS", () => {
    const css = readFileSync("packages/plugin-wbs/src/wbs.css", "utf8");
    expect(css).toMatch(/\.wbs-left\s*\{[^}]*position: sticky/);
    expect(css).toMatch(/\.wbs-header\s*\{[^}]*position: sticky/);
    expect(css).toContain("@media (width < 767px)");
    const source = readFileSync("packages/plugin-wbs/src/screen.tsx", "utf8");
    expect(source).not.toMatch(/matchMedia|innerWidth|calc\(\$\{depth\}/);
    expect(source.match(/className="wbs-scroll"/g)).toHaveLength(1);
  });
  it("starts a child Ticket draft with the declared parent reference", async () => {
    const createResource = vi.fn(async (draft: import("@vellym/plugin-api").PluginResourceDraft) => ({
      ok: true as const, name: draft.name ?? "new-ticket", draft: { ...draft, name: draft.name ?? "new-ticket", relativePath: "draft.yaml" }
    }));
    await createTicketCommand().run({ records: (kind) => kind === "TicketTracker" ? [tracker] : [],
      locale: "ja", target: tracker, input: { title: "子タスク", parent: "root", parentField: "parent" },
      createResource });
    expect(createResource).toHaveBeenCalledWith(expect.objectContaining({
      title: "子タスク", spec: expect.objectContaining({ fields: expect.objectContaining({ parent: "root" }) })
    }));
  });
  it("registers the shared Ticket engine and no WBS resource kind", () => {
    const manifest = JSON.parse(readFileSync("packages/plugin-wbs/package.json", "utf8")).vellym;
    expect(validatePluginManifest(manifest).errors).toEqual([]);
    expect(manifest.contributes.kinds.map((item: { kind: string }) => item.kind))
      .toEqual(["Ticket", "TicketTracker"]);
    const kinds: string[] = [];
    const views: Parameters<VellymPluginHost["registerView"]>[0][] = [];
    const commands: Parameters<VellymPluginHost["registerCommand"]>[0][] = [];
    plugin.activate({ pluginId: "wbs", hostVersion: "0.4.0-beta", registerKind: (value) => kinds.push(value.kind),
      registerView: (value) => views.push(value), registerCommand: (value) => commands.push(value),
      registerRecordProjection: () => {}, registerRecordSetValidator: () => {},
      registerFileKind: () => {}, registerFileSetValidator: () => {}, reportDiagnostic: () => {} });
    expect(kinds).toEqual(["Ticket", "TicketTracker"]);
    expect(views[0]).toMatchObject({ id: "wbs-tree", opensKind: "TicketTracker", static: true });
    expect(commands.map((command) => command.id)).toEqual(["ticket.create-tracker", "ticket.create"]);
  });

  it("uses Tracker-declared reference, dates and order; rejects wrong field types safely", () => {
    const descriptor = wbsView(context());
    expect(descriptor).toMatchObject({ kind: "Ticket", paperWidth: "full",
      scopeFilters: [{ columnId: "trackers", operator: "contains", value: "project" }],
      rendererData: { parentField: "parent", startField: "start", endField: "due",
        orderField: "sequence", diagnostics: [] } });
    const bad = { ...tracker, spec: { ...tracker.spec, wbs: { startField: "sequence" } } };
    const diagnostics = wbsView(context(bad)).rendererData?.diagnostics as readonly PluginDiagnostic[] | undefined;
    const diagnostic = diagnostics?.[0];
    expect(diagnostic?.code).toBe("WBS_FIELD_INVALID");
    expect(resolveLocalizedText(diagnostic!.message, "ja"))
      .toBe("startFieldには定義済みのdate項目を指定してください: sequence");
    expect(resolveLocalizedText(diagnostic!.message, "en"))
      .toBe("Choose a defined date field for startField: sequence");
    const withoutParent = { ...tracker, spec: { ...tracker.spec, wbs: { parentField: null } } };
    expect(wbsView(context(withoutParent)).rendererData).not.toHaveProperty("parentField");
  });

  it("resolves ordered detail columns and warns for excluded fields", () => {
    expect((wbsView(context()).rendererData?.columns as { id: string }[]).map((c) => c.id)).toEqual(["status", "start", "due"]);
    const target = { ...tracker, spec: { ...tracker.spec, fields: [...(tracker.spec.fields as object[]), { id: "notes", label: "Notes", type: "multiline" }],
      wbs: { ...(tracker.spec.wbs as object), columns: ["due", "bad", "notes", "parent", "sequence", "status"] } } };
    const data = wbsView(context(target)).rendererData!;
    expect((data.columns as { id: string }[]).map((c) => c.id)).toEqual(["due", "status"]);
    expect((data.diagnostics as PluginDiagnostic[]).map((d) => d.path)).toEqual([1, 2, 3, 4].map((i) => `/spec/wbs/columns/${i}`));
  });

  it("sorts sibling rows, leaving missing ranks visible and updating only one rank", () => {
    const nodes: TicketTreeNode[] = [
      { row: { name: "a", title: "A", values: { "field:sequence": 1 } }, children: [] },
      { row: { name: "b", title: "B", values: { "field:sequence": 2 } }, children: [] },
      { row: { name: "c", title: "C", values: {} }, children: [] }
    ];
    expect(sortedSiblings([...nodes].reverse(), "sequence", "ja").map((item) => item.row.name))
      .toEqual(["a", "b", "c"]);
    expect(rankForMove(nodes.map((node) => node.row), 0, 1, "sequence")).toBe(3);
  });

  it("guards raw cyclic descendants and appends after tied finite ranks without rewriting siblings", () => {
    const rows = [
      { name: "a", title: "A", values: { "field:parent": "b", "field:sequence": 4 } },
      { name: "b", title: "B", values: { "field:parent": "a", "field:sequence": 4 } },
      { name: "c", title: "C", values: { "field:parent": "b", "field:sequence": 4 } }
    ];
    expect([...excludedParents(rows, "a", "parent")].sort()).toEqual(["a", "b", "c"]);
    expect(rankForAppend(rows, "sequence")).toBe(5);
    expect(rankForAppend([{ name: "unset", title: "Unset", values: {} }], "sequence")).toBeUndefined();
    expect(rankForAppend([{ name: "max", title: "Max", values: { "field:sequence": Number.MAX_VALUE } }], "sequence")).toBeUndefined();
    expect(rankForInsert(rows, 0, 1, "sequence")).toBeUndefined();
    expect(rows.map((row) => row.values["field:sequence"])).toEqual([4, 4, 4]);
  });

  it("calculates indent and outdent targets without changing sibling rows", () => {
    const rows: PluginIndexRow[] = [
      { name: "a", title: "A", values: { "field:sequence": 1 } },
      { name: "b", title: "B", values: { "field:sequence": 2 } },
      { name: "c", title: "C", values: { "field:sequence": 3 } },
      { name: "a-child", title: "A child", values: { "field:parent": "a", "field:sequence": 4 } }
    ];
    expect(indentTarget(rows, "b", "parent", "sequence", "en")).toEqual({ parent: "a", order: 5 });
    expect(outdentTarget(rows, "a-child", "parent", "sequence", "en")).toEqual({ parent: "", order: 1.5 });
    expect(indentTarget(rows, "a", "parent", "sequence", "en")).toBeUndefined();
    expect(outdentTarget(rows, "a", "parent", "sequence", "en")).toBeUndefined();
    expect(indentTarget(rows, "b", "parent", undefined, "en")).toEqual({ parent: "a" });
    expect(outdentTarget(rows, "a-child", "parent", undefined, "en")).toEqual({ parent: "" });
    expect(rows.map((row) => row.values["field:sequence"])).toEqual([1, 2, 3, 4]);
  });

  it("does not offer hierarchy moves for unresolved or cyclic ancestry", () => {
    const rows = [
      { name: "orphan", title: "Orphan", values: { "field:parent": "missing" } },
      { name: "a", title: "A", values: { "field:parent": "b" } },
      { name: "b", title: "B", values: { "field:parent": "a" } }
    ];
    expect(indentTarget(rows, "orphan", "parent")).toBeUndefined();
    expect(outdentTarget(rows, "orphan", "parent")).toBeUndefined();
    expect(indentTarget(rows, "a", "parent")).toBeUndefined();
    expect(outdentTarget(rows, "b", "parent")).toBeUndefined();
  });
});
