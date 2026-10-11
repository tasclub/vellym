import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PluginResourceRecord, PluginViewContext, VellymPluginHost } from "@vellym/plugin-api";
import type { TicketTreeNode } from "../packages/ticket-engine/src/hierarchy.js";
import { validatePluginManifest } from "@vellym-internal/core";
import plugin from "../packages/plugin-wbs/src/node.js";
import { rankForMove, sortedSiblings } from "../packages/plugin-wbs/src/model.js";
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
      registerRecordProjection: () => {}, reportDiagnostic: () => {} });
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
    expect(wbsView(context(bad)).rendererData).toMatchObject({
      diagnostics: [expect.objectContaining({ code: "WBS_FIELD_INVALID" })]
    });
    const withoutParent = { ...tracker, spec: { ...tracker.spec, wbs: { parentField: null } } };
    expect(wbsView(context(withoutParent)).rendererData).not.toHaveProperty("parentField");
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
});
