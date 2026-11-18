import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginResourceRecord,
  PluginViewContext,
  VellymPluginHost
} from "@vellym/plugin-api";
import { validatePluginManifest } from "@vellym-internal/core";
import { pluginResourceRelativePath } from "@vellym-internal/runtime-node";
import plugin from "@vellym/tickets";
import { ticketListView } from "../packages/plugin-tickets/src/views.js";
import { TICKET_ENGINE_VERSION } from "@vellym-internal/ticket-engine";
import {
  initialTicketSpec,
  readTrackers
} from "@vellym-internal/ticket-engine";

function record(
  kind: string,
  name: string,
  relativePath: string,
  spec: Record<string, unknown> = {}
): PluginResourceRecord {
  return { kind, name, title: name, relativePath, spec, readOnly: false };
}

/** 単体テスト工程のチケット管理 */
const unitTests = record(
  "TicketTracker",
  "unit-test-tickets",
  "30-実装/単体テスト/unit-test-tickets.yaml",
  {
    statuses: [
      { id: "open", label: "未対応", category: "open" },
      { id: "fixed", label: "修正済", category: "closed" }
    ],
    fields: [
      { id: "caseId", label: "ケースID", type: "text", required: true, listColumn: true },
      // 宣言が無いので列にはならない。詳細では出る。
      { id: "note", label: "補足", type: "multiline" }
    ]
  }
);

/** 不具合のチケット管理。ステータスも項目も別物 */
const defects = record("TicketTracker", "defect-tickets", "40-品質/defect-tickets.yaml", {
  statuses: [
    { id: "triage", label: "調査中", category: "open" },
    { id: "closed", label: "完了", category: "closed" }
  ],
  fields: [
    {
      id: "severity",
      label: "重大度",
      type: "select",
      listColumn: true,
      options: [
        { value: "high", label: "高" },
        { value: "low", label: "低" }
      ]
    }
  ]
});

const trackers = [unitTests, defects];

it("passes tracker summary definitions to the generic list descriptor", () => {
  const tracker = record("TicketTracker", "summary", "summary.yaml", {
    statuses: [{ id: "open", label: "Open", category: "open" }],
    fields: [{ id: "points", label: "Points", type: "number" }],
    summary: [{ field: "points", method: "sum" }]
  });
  expect(ticketListView(context([tracker], tracker)).summary).toEqual([
    { valueKey: "field:points", type: "number", method: "sum", label: "Points" }
  ]);
  expect(ticketListView(context([unitTests], unitTests)).summary).toBeUndefined();
});

function context(
  definitions: PluginResourceRecord[],
  target?: PluginResourceRecord
): PluginViewContext {
  return {
    locale: "ja",
    isStatic: false,
    ...(target ? { target } : {}),
    records: (kind) => definitions.filter((item) => item.kind === kind)
  };
}

function activate() {
  const kinds = new Map<string, Parameters<VellymPluginHost["registerKind"]>[0]>();
  const views = new Map<string, Parameters<VellymPluginHost["registerView"]>[0]>();
  const commands = new Map<string, Parameters<VellymPluginHost["registerCommand"]>[0]>();
  const projections = new Map<
    string,
    Parameters<VellymPluginHost["registerRecordProjection"]>[1]
  >();
  const recordSetValidators = new Map<
    string,
    Parameters<VellymPluginHost["registerRecordSetValidator"]>[1]
  >();
  plugin.activate({
    pluginId: "tickets",
    hostVersion: "0.3.0-beta.1",
    registerKind: (contribution) => kinds.set(contribution.kind, contribution),
    registerView: (contribution) => views.set(contribution.id, contribution),
    registerCommand: (contribution) => commands.set(contribution.id, contribution),
    registerRecordProjection: (kind, create) => projections.set(kind, create),
    registerRecordSetValidator: (kind, validate) => recordSetValidators.set(kind, validate),
    reportDiagnostic: () => {}
  });
  return { kinds, views, commands, projections, recordSetValidators };
}

function project(definitions: PluginResourceRecord[], ticket: PluginResourceRecord) {
  const create = activate().projections.get("Ticket");
  if (!create) throw new Error("Ticket projection was not registered");
  return create(context(definitions))(ticket);
}

function definitionDiagnostics(definitions: PluginResourceRecord[]) {
  const create = activate().projections.get("Ticket");
  if (!create) throw new Error("Ticket projection was not registered");
  const diagnostics: import("@vellym/plugin-api").PluginDiagnostic[] = [];
  create({
    records: (kind) => definitions.filter((item) => item.kind === kind),
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });
  return diagnostics;
}

function listView(target?: PluginResourceRecord) {
  const view = activate().views.get("ticket-list")?.view;
  if (typeof view !== "function") throw new Error("expected a view provider");
  const descriptor = view(context(trackers, target));
  if (descriptor.type !== "list") throw new Error("expected a list descriptor");
  return descriptor;
}

describe("ticket plugin", () => {
  it("resolves settings UI copy through PluginLocalizedText rather than locale branches", () => {
    const screen = readFileSync(
      path.join(process.cwd(), "packages/plugin-tickets/src/settings-screen.tsx"),
      "utf8"
    );
    expect(screen).not.toMatch(/locale\.startsWith\(["']ja["']\)/);
    expect(screen).toContain("resolveLocalizedText");
  });

  it("ships a responsive, plugin-scoped settings grid stylesheet", () => {
    const stylesheet = readFileSync(
      path.join(process.cwd(), "packages/plugin-tickets/src/tickets-settings.css"),
      "utf8"
    );
    expect(stylesheet).toContain(".tickets-settings-field-grid");
    expect(stylesheet).toContain(".tickets-settings-option-grid");
    expect(stylesheet).toContain("@media (max-width: 760px)");
  });

  it("ships a manifest that matches what activate registers", () => {
    // manifestは「コードを読まずに分かる必要がある宣言」であり、実装とずれると
    // 利用者は「入れたのに出てこない」理由を知る手段を失う。
    const manifest = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "packages/plugin-tickets/package.json"),
        "utf8"
      )
    ).vellym;
    expect(validatePluginManifest(manifest).errors).toEqual([]);

    const { kinds, views, commands } = activate();
    expect(manifest.contributes.kinds.map((item: { kind: string }) => item.kind)).toEqual(
      [...kinds.keys()]
    );
    expect(manifest.contributes.views.map((item: { id: string }) => item.id)).toEqual(
      [...views.keys()]
    );
    expect(manifest.contributes.commands.map((item: { id: string }) => item.id)).toEqual(
      [...commands.keys()]
    );
  });

  it("puts trackers in the document tree and tickets outside it", () => {
    const { kinds, commands } = activate();
    expect(kinds.get("Ticket")?.showInDocumentTree).toBe(false);
    expect(kinds.get("Ticket")?.engineVersion).toBe(TICKET_ENGINE_VERSION);
    expect(kinds.get("TicketTracker")?.showInDocumentTree).toBe(true);
    expect(kinds.get("TicketTracker")?.engineVersion).toBe(TICKET_ENGINE_VERSION);
    expect(kinds.get("TicketTracker")?.hasBlocks).toBe(false);
    // 作成は静的版へ出さない。
    expect(commands.get("ticket.create")?.static).toBe(false);
  });

  it("assigns a ticket to the nearest tracker above it", () => {
    const values = (relativePath: string) =>
      project(trackers, record("Ticket", "ticket-01", relativePath, { status: "open" }))?.values;
    expect(values("30-実装/単体テスト/ticket-01.yaml")?.tracker).toBe("unit-test-tickets");
    // 子孫フォルダも同じチケット管理に属する。
    expect(values("30-実装/単体テスト/api/ticket-01.yaml")?.tracker).toBe("unit-test-tickets");
    expect(values("40-品質/ticket-01.yaml")?.tracker).toBe("defect-tickets");
    // どのTicketTrackerの配下でもない場所。
    expect(values("notes/ticket-01.yaml")?.tracker).toBe("");
  });

  it("leaves tickets under an underscore folder out of every list, silently", () => {
    // 残したいが一覧に出したくないチケットの逃げ道。警告も出さない。
    for (const relativePath of [
      "_保留/ticket-01.yaml",
      "30-実装/単体テスト/_保留/ticket-01.yaml",
      // アーカイブはCoreの走査から除外されるが、二重の防御として同じ扱いにする。
      "_archive/30-実装/単体テスト/ticket-01.yaml"
    ]) {
      expect(project(trackers, record("Ticket", "ticket-01", relativePath, {}))).toBeUndefined();
    }
  });

  it("keeps tickets under a plus folder in the index row", () => {
    const projection = project(
      trackers,
      record(
        "Ticket",
        "ticket-01",
        "30-実装/単体テスト/+machine/nested/ticket-01.yaml",
        { status: "open", fields: { caseId: "UT-1" } }
      )
    );

    // `+`はツリーだけを隠す印であり、一覧除外の判定には使わない。
    expect(projection?.values).toMatchObject({
      tracker: "unit-test-tickets",
      trackers: ["unit-test-tickets"],
      status: "open",
      "field:caseId": "UT-1"
    });
    expect(projection?.diagnostics).toBeUndefined();
  });

  it("lists a ticket in every tracker above it, judged by the nearest one", () => {
    const nested = record(
      "TicketTracker",
      "api-tickets",
      "30-実装/単体テスト/api/api-tickets.yaml",
      { statuses: [{ id: "todo", label: "未着手", category: "open" }] }
    );
    const projection = project(
      [...trackers, nested],
      record("Ticket", "ticket-01", "30-実装/単体テスト/api/ticket-01.yaml", { status: "todo" })
    );
    // 定義を与えるのは最も近い祖先。
    expect(projection?.values.tracker).toBe("api-tickets");
    // 一覧には親側にも出す。属性でフォルダ分けしても親から見えなくならない。
    expect(projection?.values.trackers).toEqual(["api-tickets", "unit-test-tickets"]);
    expect(projection?.diagnostics).toBeUndefined();
  });

  it("judges a ticket against its own tracker, not another one", () => {
    // triage は不具合側の値。単体テスト側では定義外になる。
    const codes = project(
      trackers,
      record("Ticket", "ticket-01", "30-実装/単体テスト/ticket-01.yaml", {
        status: "triage",
        fields: { caseId: "UT-1" }
      })
    )?.diagnostics?.map((item) => item.code);
    expect(codes).toEqual(["TICKET_STATUS_UNDEFINED"]);
  });

  it("warns instead of failing when data does not match the definitions", () => {
    const codes = (spec: Record<string, unknown>) =>
      project(
        trackers,
        record("Ticket", "ticket-01", "30-実装/単体テスト/ticket-01.yaml", spec)
      )?.diagnostics?.map((item) => item.code);
    expect(codes({ fields: { caseId: "UT-1" } })).toEqual(["TICKET_STATUS_MISSING"]);
    expect(codes({ status: "open", fields: { caseId: "UT-1", extra: "x" } })).toEqual([
      "TICKET_FIELD_UNDEFINED"
    ]);
    expect(codes({ status: "open", fields: { caseId: 1 } })).toEqual([
      "TICKET_FIELD_TYPE_MISMATCH"
    ]);
    expect(codes({ status: "open", fields: {} })).toEqual(["TICKET_FIELD_REQUIRED_MISSING"]);
  });

  it("checks options only for correctly typed defined fields with options", () => {
    const tracker = record("TicketTracker", "options-tracker", "opts/tracker.yaml", {
      statuses: [{ id: "open", label: "Open", category: "open" }],
      fields: [
        { id: "one", label: "One", type: "select", options: [{ value: "yes", label: "Yes" }] },
        { id: "many", label: "Many", type: "multiselect", options: [{ value: "yes", label: "Yes" }] },
        { id: "empty", label: "Empty", type: "select", options: [] },
        { id: "absent", label: "Absent", type: "multiselect" }
      ]
    });
    const result = project([tracker], record("Ticket", "t", "opts/t.yaml", {
      status: "open", fields: { one: "no", many: ["yes", "no", "other"], empty: "x", absent: ["x"], extra: "x" }
    }));
    const options = result?.diagnostics?.filter((d) => d.code === "TICKET_FIELD_OPTION_UNDEFINED") ?? [];
    expect(options.map((d) => d.path)).toEqual(["/spec/fields/one", "/spec/fields/many"]);
    for (const d of options) {
      expect(d.severity).toBe("warning");
      expect(JSON.stringify(d.message)).toContain(d.path!.split("/").at(-1));
    }
    expect(JSON.stringify(options[1]?.message)).toContain("no");
    expect(JSON.stringify(options[1]?.message)).toContain("other");
    expect(result?.values["field:many"]).toEqual(["yes", "no", "other"]);
    const mismatch = project([tracker], record("Ticket", "t", "opts/t.yaml", {
      status: "open", fields: { one: 1, many: ["bad", 2] }
    }));
    expect(mismatch?.diagnostics?.map((d) => d.code)).toEqual([
      "TICKET_FIELD_TYPE_MISMATCH", "TICKET_FIELD_TYPE_MISMATCH"
    ]);
  });

  it("says a ticket outside every tracker is not lost, only unlisted", () => {
    const projection = project(
      trackers,
      record("Ticket", "ticket-01", "notes/ticket-01.yaml", { status: "whatever" })
    );
    expect(projection?.diagnostics?.map((item) => item.code)).toEqual([
      "TICKET_TRACKER_MISSING"
    ]);
    // 所属が無ければ定義も無い。定義外とは言えない。
    expect(projection?.values.status).toBe("whatever");
  });

  it("builds a different list for each tracker", () => {
    const unit = listView(unitTests);
    expect(unit.title).toBe("unit-test-tickets");
    expect(unit.columns.map((column) => column.id)).toEqual([
      "title",
      "status",
      "field:caseId",
      // ラベルは列を増やさずに畳んで見せ、絞り込みだけできるようにする。
      "labels"
    ]);
    expect(unit.columns.find((column) => column.id === "labels")?.secondary).toBe(true);
    // 所属での絞り込みは利用者が外せない。状態の絞り込みは初期値であり外せる。
    expect(unit.scopeFilters).toEqual([
      { columnId: "trackers", operator: "contains", value: "unit-test-tickets" }
    ]);
    // 既定の絞り込みは外せる切替として画面に出る。文言はプラグインが持ち、
    // 入と切で別の文言を宣言する。hostは「未完了」のような語を知らない。
    expect(unit.defaultFilters).toEqual([
      {
        columnId: "status",
        operator: "not-in",
        value: ["fixed"],
        toggleLabels: {
          applied: { ja: "未完了のみ", en: "Open only" },
          cleared: { ja: "すべて表示中", en: "Showing all" }
        }
      }
    ]);

    const defect = listView(defects);
    expect(defect.columns.map((column) => column.id)).toEqual([
      "title",
      "status",
      "field:severity",
      "labels"
    ]);
    // まとめて変えられるのはステータスと単一選択まで。宣言した列だけが対象になる。
    expect(
      defect.columns.filter((column) => column.editPath).map((column) => column.editPath)
    ).toEqual([["status"], ["fields", "severity"]]);
    expect(defect.scopeFilters?.[0]).toEqual({
      columnId: "trackers",
      operator: "contains",
      value: "defect-tickets"
    });
  });

  it("builds the detail from the tracker the ticket belongs to", () => {
    const view = activate().views.get("ticket-detail")?.view;
    if (typeof view !== "function") throw new Error("expected a view provider");
    const detail = view(
      context(trackers, record("Ticket", "ticket-01", "40-品質/ticket-01.yaml"))
    );
    if (detail.type !== "detail") throw new Error("expected a detail descriptor");
    expect(detail.body).toBe("blocks");
    expect(detail.undeclaredFields).toBe("read-only");
    expect(detail.fields.map((field) => field.path)).toEqual([
      ["status"],
      ["fields", "severity"]
    ]);
    // 単一参照の項目には`multiple`を付けない。詳細の入力欄は従来どおり1値。
    expect(detail.fields.every((field) => field.multiple === undefined)).toBe(true);
  });

  it("marks a multiple reference field on the detail descriptor", () => {
    const related = record("TicketTracker", "multi-tickets", "multi/multi.yaml", {
      statuses: [{ id: "open", label: "Open", category: "open" }],
      fields: [
        { id: "parent", label: "Parent", type: "reference", listColumn: true },
        { id: "dependsOn", label: "Depends on", type: "reference", multiple: true }
      ]
    });
    const view = activate().views.get("ticket-detail")?.view;
    if (typeof view !== "function") throw new Error("expected a view provider");
    const detail = view(context([related], record("Ticket", "ticket-01", "multi/ticket-01.yaml")));
    if (detail.type !== "detail") throw new Error("expected a detail descriptor");
    const byId = new Map(detail.fields.map((field) => [field.id, field]));
    expect(byId.get("parent")?.multiple).toBeUndefined();
    expect(byId.get("dependsOn")?.multiple).toBe(true);
    expect(byId.get("dependsOn")?.type).toBe("reference");
  });

  it("puts only declared fields in the list, but every field in the detail", () => {
    // `note`は`listColumn`を宣言していない。列にはならないが、詳細では編集できる。
    expect(listView(unitTests).columns.map((column) => column.id)).not.toContain(
      "field:note"
    );
    const view = activate().views.get("ticket-detail")?.view;
    if (typeof view !== "function") throw new Error("expected a view provider");
    const detail = view(
      context(
        trackers,
        record("Ticket", "ticket-01", "30-実装/単体テスト/ticket-01.yaml")
      )
    );
    if (detail.type !== "detail") throw new Error("expected a detail descriptor");
    expect(detail.fields.map((field) => field.path)).toEqual([
      ["status"],
      ["fields", "caseId"],
      ["fields", "note"]
    ]);
  });

  it("orders detail fields: list columns, then single-line, then multi-line, each in definition order", () => {
    // ticket-01m7k6gftnq66d3qh00knvzbnc
    const mixed = record("TicketTracker", "mixed", "mixed/mixed.yaml", {
      statuses: [{ id: "open", label: "Open", category: "open" }],
      fields: [
        { id: "notes", label: "Notes", type: "multiline" },
        { id: "owner", label: "Owner", type: "text" },
        { id: "due", label: "Due", type: "date", listColumn: true },
        { id: "summary", label: "Summary", type: "multiline", listColumn: true },
        { id: "points", label: "Points", type: "number" },
        { id: "risk", label: "Risk", type: "multiline" },
        { id: "priority", label: "Priority", type: "select", listColumn: true, options: [{ value: "high", label: "High" }] }
      ]
    });
    const view = activate().views.get("ticket-detail")?.view;
    if (typeof view !== "function") throw new Error("expected a view provider");
    const detail = view(context([mixed], record("Ticket", "ticket-01", "mixed/ticket-01.yaml")));
    if (detail.type !== "detail") throw new Error("expected a detail descriptor");
    expect(detail.fields.map((field) => field.id)).toEqual([
      "status", "due", "summary", "priority", "owner", "points", "notes", "risk"
    ]);
  });

  it("creates without asking anything first", () => {
    // 作成用の画面を別に持たない。押すと初期値だけのドラフトになり、
    // そのまま編集画面で全部を書く。保存前に正本を開き直させない。
    expect(activate().commands.get("ticket.create")?.inputs).toBeUndefined();
  });

  it("creates an indexed in-memory draft under the tracker's +tickets folder", async () => {
    const tracker = record(
      "TicketTracker",
      "quality-tickets",
      "40-品質/quality-tickets.yaml",
      {
        statuses: [{ id: "todo", label: "未対応", category: "open" }],
        fields: [
          {
            id: "priority",
            label: "優先度",
            type: "select",
            required: true,
            options: [{ value: "mid", label: "中" }]
          },
          {
            id: "readiness",
            label: "準備状況",
            type: "select",
            required: true,
            options: [{ value: "ready", label: "着手可" }]
          }
        ]
      }
    );
    const command = activate().commands.get("ticket.create");
    if (!command) throw new Error("ticket.create was not registered");
    // createResourceはhostのステージング口であり、ファイル保存のmockではない。
    const stage = vi.fn(async (draft: import("@vellym/plugin-api").PluginResourceDraft) => {
      if (!draft.name) throw new Error("ticket name is required");
      return { ok: true as const, name: draft.name, draft: { ...draft, name: draft.name } };
    });
    const result = await command.run({
      locale: "ja",
      target: tracker,
      records: (kind) => kind === "TicketTracker" ? [tracker] : [],
      createResource: stage
    });

    expect(stage).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      draft: {
        kind: "Ticket",
        folder: "40-品質/+tickets",
        spec: {
          status: "todo",
          fields: { priority: "mid", readiness: "ready" },
          blocks: [{ id: "description", type: "rich-text", content: "" }]
        }
      }
    });
    if (!result.ok) throw new Error("ticket creation failed");
    const relativePath = pluginResourceRelativePath(result.draft);
    expect(relativePath).toBe(`40-品質/+tickets/${result.draft.name}.yaml`);
    expect(
      project(
        [tracker],
        record("Ticket", result.draft.name, relativePath, result.draft.spec)
      )?.values.trackers
    ).toEqual(["quality-tickets"]);
  });

  it("keeps the content root default when no tracker can be found", async () => {
    const command = activate().commands.get("ticket.create");
    if (!command) throw new Error("ticket.create was not registered");
    const stage = vi.fn(async (draft: import("@vellym/plugin-api").PluginResourceDraft) => {
      if (!draft.name) throw new Error("ticket name is required");
      return { ok: true as const, name: draft.name, draft: { ...draft, name: draft.name } };
    });

    const result = await command.run({
      locale: "ja",
      records: () => [],
      createResource: stage
    });

    expect(stage).toHaveBeenCalledOnce();
    if (!result.ok) throw new Error("ticket creation failed");
    expect(result.draft).not.toHaveProperty("folder");
    expect(pluginResourceRelativePath(result.draft)).toBe(`${result.draft.name}.yaml`);
  });

  it("creates a tracker with the standard statuses and opens its settings", async () => {
    const command = activate().commands.get("ticket.create-tracker");
    if (!command) throw new Error("ticket.create-tracker was not registered");
    const stage = vi.fn(async (draft: import("@vellym/plugin-api").PluginResourceDraft) => {
      if (!draft.name) throw new Error("tracker name is required");
      return { ok: true as const, name: draft.name, draft: { ...draft, name: draft.name } };
    });
    const result = await command.run({
      locale: "ja",
      input: { title: "開発チケット", folder: "30-実装" },
      records: () => [],
      createResource: stage
    });

    expect(stage).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      openView: "ticket-tracker-settings",
      draft: {
        kind: "TicketTracker",
        folder: "30-実装",
        spec: {
          statuses: [
            { id: "todo", label: "未着手", category: "open" },
            { id: "doing", label: "対応中", category: "open" },
            { id: "done", label: "完了", category: "closed" }
          ],
          fields: []
        }
      }
    });
  });

  it("warns once per select-like field whose definition has no valid options", () => {
    const definition = record(
      "TicketTracker",
      "empty-options",
      "40-品質/empty-options.yaml",
      {
        statuses: [{ id: "todo", label: "未着手", category: "open" }],
        fields: [
          { id: "priority", label: "優先度", type: "select", options: [] },
          { id: "labels", label: "ラベル", type: "multiselect" },
          { id: "owner", label: "担当", type: "reference" },
          {
            id: "severity",
            label: "重大度",
            type: "select",
            options: [{ value: "high", label: "高" }]
          }
        ]
      }
    );

    expect(definitionDiagnostics([definition])).toEqual([
      {
        file: "40-品質/empty-options.yaml",
        path: "/spec/fields/0/options",
        severity: "warning",
        code: "TICKET_FIELD_OPTIONS_MISSING",
        message: {
          ja: "選択式の項目に選択肢がありません: priority",
          en: "Select fields must have options: priority"
        }
      },
      {
        file: "40-品質/empty-options.yaml",
        path: "/spec/fields/1/options",
        severity: "warning",
        code: "TICKET_FIELD_OPTIONS_MISSING",
        message: {
          ja: "選択式の項目に選択肢がありません: labels",
          en: "Select fields must have options: labels"
        }
      }
    ]);

    // チケット件数には依存せず、factoryで定義を読んだときだけ報告する。
    expect(
      project(
        [definition],
        record("Ticket", "ticket-01", "40-品質/ticket-01.yaml", { status: "todo" })
      )?.diagnostics
    ).toBeUndefined();
  });

  it("puts labels in the index row so the list can filter on them", () => {
    const projection = project(trackers, {
      kind: "Ticket",
      name: "ticket-01",
      title: "ticket-01",
      relativePath: "40-品質/ticket-01.yaml",
      labels: { component: "ui" },
      spec: { status: "triage" },
      readOnly: false
    });
    // どんなキーが使われるかは定義から分からない。列を増やさず1つの値にする。
    expect(projection?.values.labels).toEqual(["component=ui"]);
  });

  it("derives initial values from the order of the definitions", () => {
    const [defect, unit] = readTrackers(context(trackers));
    // ステータスは定義の先頭。宣言ではなく並び順で決まる。
    expect(initialTicketSpec(unit)).toEqual({ status: "open" });
    // 単一選択は選択肢の先頭。値を持たない型はキーごと書かない。
    expect(initialTicketSpec(defect)).toEqual({
      status: "triage",
      fields: { severity: "high" }
    });
    // 所属が無ければ何も決められない。
    expect(initialTicketSpec(undefined)).toEqual({});
  });

  it("gives booleans and multi-selects an initial value, and text none", () => {
    const definition = record("TicketTracker", "kinds", "40-品質/kinds.yaml", {
      statuses: [],
      fields: [
        { id: "flag", label: "旗", type: "boolean" },
        { id: "tags", label: "札", type: "multiselect" },
        { id: "memo", label: "メモ", type: "text" },
        { id: "due", label: "期限", type: "date" }
      ]
    });
    const tracker = readTrackers(context([definition]))[0];
    // 空文字を入れておくのと「まだ何も入れていない」は別のことである。
    expect(initialTicketSpec(tracker)).toEqual({ fields: { flag: false, tags: [] } });
  });

  it("still shows a list when the tracker defines nothing yet", () => {
    const empty = record("TicketTracker", "new-tracker", "10-要件/new-tracker.yaml", {});
    const view = activate().views.get("ticket-list")?.view;
    if (typeof view !== "function") throw new Error("expected a view provider");
    const descriptor = view(context([empty], empty));
    if (descriptor.type !== "list") throw new Error("expected a list descriptor");
    expect(descriptor.columns.map((column) => column.id)).toEqual(["title", "labels"]);
    expect(descriptor.emptyState?.message).toMatchObject({
      ja: expect.stringContaining("ステータス")
    });
  });
});

describe("status category on the index row", () => {
  const values = (spec: Record<string, unknown>, relativePath = "30-実装/単体テスト/t.yaml") =>
    project(trackers, record("Ticket", "ticket-01", relativePath, spec))?.values;

  it("copies the category from the tracker's statuses", () => {
    expect(values({ status: "open" })?.statusCategory).toBe("open");
    expect(values({ status: "fixed" })?.statusCategory).toBe("closed");
  });

  it("leaves the category out when the status is missing or undefined", () => {
    // 定義に無い状態・未設定・Trackerの配下外。値を作らず、既存の警告だけで示す。
    expect(values({ status: "no-such-status" })?.statusCategory).toBeUndefined();
    expect(values({})?.statusCategory).toBeUndefined();
    expect(values({ status: "open" }, "notes/t.yaml")?.statusCategory).toBeUndefined();
  });
});

describe("record set validator from the shared engine", () => {
  const related = record("TicketTracker", "related-tickets", "50-設計/related-tickets.yaml", {
    statuses: [{ id: "open", label: "未対応", category: "open" }],
    fields: [
      { id: "parent", label: "親", type: "reference" },
      { id: "dependsOn", label: "依存", type: "reference" }
    ],
    hierarchy: { parentField: "parent" }
  });

  function row(
    name: string,
    fields: Record<string, string | readonly string[]>,
    owners = ["related-tickets"]
  ) {
    return {
      name,
      title: name,
      values: {
        tracker: owners[0] ?? "",
        trackers: owners,
        ...Object.fromEntries(Object.entries(fields).map(([id, v]) => [`field:${id}`, v]))
      }
    };
  }

  it("registers one validator for Ticket", () => {
    expect(activate().recordSetValidators.get("Ticket")).toBeTypeOf("function");
  });

  it("warns about unresolved parents, cycles, unresolved references and self references", () => {
    const validate = activate().recordSetValidators.get("Ticket");
    if (!validate) throw new Error("validator was not registered");
    const diagnostics = validate(
      [
        row("ticket-a", { parent: "ticket-missing" }),
        row("ticket-b", { parent: "ticket-c" }),
        row("ticket-c", { parent: "ticket-b" }),
        row("ticket-d", { dependsOn: "ticket-gone" }),
        row("ticket-e", { dependsOn: "ticket-e" }),
        // 解決できる参照は警告しない。配列の値も解決する。
        row("ticket-f", { parent: "ticket-a", dependsOn: ["ticket-e", "ticket-nowhere"] }),
        // 所有者が別のTrackerの行は、このTrackerが二重に警告しない。
        row("ticket-z", { parent: "ticket-void" }, ["other-tickets", "related-tickets"])
      ],
      context([related])
    );
    expect(
      [...diagnostics].map((d) => `${d.code} ${d.file} ${d.path} ${d.severity}`).sort()
    ).toEqual([
      "TICKET_PARENT_CYCLE ticket-b /spec/fields/parent warning",
      "TICKET_PARENT_CYCLE ticket-c /spec/fields/parent warning",
      "TICKET_PARENT_UNRESOLVED ticket-a /spec/fields/parent warning",
      "TICKET_REFERENCE_SELF ticket-e /spec/fields/dependsOn warning",
      "TICKET_REFERENCE_UNRESOLVED ticket-d /spec/fields/dependsOn warning",
      "TICKET_REFERENCE_UNRESOLVED ticket-f /spec/fields/dependsOn warning"
    ]);
  });
});
