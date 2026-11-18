import { describe, expect, it } from "vitest";
import type { PluginResourceRecord, PluginViewContext } from "@vellym/plugin-api";
import {
  readTrackers,
  trackerDefinitionDiagnostics
} from "../packages/ticket-engine/src/definitions.js";
import { ticketListView } from "../packages/plugin-tickets/src/views.js";

function record(
  name: string,
  spec: Record<string, unknown>
): PluginResourceRecord {
  return {
    kind: "TicketTracker",
    name,
    title: name,
    relativePath: `${name}/${name}.yaml`,
    spec,
    readOnly: false
  };
}

function context(definitions: PluginResourceRecord[]): PluginViewContext {
  return {
    locale: "ja",
    isStatic: false,
    records: (kind) => definitions.filter((item) => item.kind === kind)
  };
}

/** 列・絞り込み・並べ替えの宣言を1つずつずらした項目 */
const MIXED_FIELDS = [
  // 宣言どおり。listColumnのみの既定は今までと同じ（絞り込み・並べ替えも有効）
  { id: "plain", label: "PLAIN", type: "text", listColumn: true },
  // 宣言が無い。列にも絞り込みにも並べ替えにも出ない
  { id: "quiet", label: "QUIET", type: "text" },
  // 列に出さず絞り込みだけ。選択肢付きでも一括編集には入れない
  { id: "hiddenFilter", label: "HIDDENFILTER", type: "select", filter: true,
    options: [{ value: "on", label: "ON" }] },
  // 列に出さず並べ替えだけ。defaultSortの候補にできる
  { id: "hiddenSort", label: "HIDDENSORT", type: "number", sort: true },
  // 列に出すが絞り込み・並べ替えは明示的に無効へ戻す
  { id: "visiblePlain", label: "VISIBLEPLAIN", type: "text", listColumn: true, filter: false, sort: false }
];

const mixed = record("mixed", {
  statuses: [{ id: "open", label: "OPEN", category: "open" }],
  fields: MIXED_FIELDS
});

describe("tracker field declarations: listColumn / filter / sort", () => {
  it("holds the effective value, defaulting filter and sort to listColumn", () => {
    const [tracker] = readTrackers(context([mixed]));
    expect(tracker?.fields.map((field) => [field.id, field.listColumn, field.filter, field.sort]))
      .toEqual([
        ["plain", true, true, true],
        ["quiet", false, false, false],
        ["hiddenFilter", false, true, false],
        ["hiddenSort", false, false, true],
        ["visiblePlain", true, false, false]
      ]);
  });

  it("makes filter-only and sort-only fields hidden columns and leaves plain fields alone", () => {
    const view = ticketListView(context([mixed]));
    const byId = new Map(view.columns.map((column) => [column.id, column]));
    // 宣言の無い項目は列にすらならない（詳細で読む）
    expect(byId.has("field:quiet")).toBe(false);

    const plain = byId.get("field:plain");
    expect(plain?.hidden).toBeUndefined();
    expect(plain?.sortable).toBe(true);
    expect(plain?.filterable).toBe(true);

    const hiddenFilter = byId.get("field:hiddenFilter");
    expect(hiddenFilter?.hidden).toBe(true);
    expect(hiddenFilter?.filterable).toBe(true);
    expect(hiddenFilter?.sortable).toBe(false);
    // 隠れた列は一括編集の対象にしない。見えない行が変わる。
    expect(hiddenFilter?.editPath).toBeUndefined();

    const hiddenSort = byId.get("field:hiddenSort");
    expect(hiddenSort?.hidden).toBe(true);
    expect(hiddenSort?.sortable).toBe(true);
    expect(hiddenSort?.filterable).toBe(false);

    const visiblePlain = byId.get("field:visiblePlain");
    expect(visiblePlain?.hidden).toBeUndefined();
    expect(visiblePlain?.sortable).toBe(false);
    expect(visiblePlain?.filterable).toBe(false);
  });
});

describe("tracker spec.defaultSort", () => {
  it("resolves the field definition, and the list view uses it", () => {
    const tracker = record("sorted", {
      statuses: [{ id: "open", label: "OPEN", category: "open" }],
      fields: MIXED_FIELDS,
      // 列に出さない項目でも、sortが有効なら既定の並べ替えにできる
      defaultSort: { field: "hiddenSort", direction: "desc" }
    });
    const [parsed] = readTrackers(context([tracker]));
    expect(parsed?.defaultSort).toEqual({
      field: expect.objectContaining({ id: "hiddenSort" }),
      direction: "desc"
    });
    expect(ticketListView(context([tracker])).defaultSort)
      .toEqual({ columnId: "field:hiddenSort", direction: "desc" });
    expect(trackerDefinitionDiagnostics([tracker])).toEqual([]);
  });

  it("defaults the direction to asc when it is not declared", () => {
    const tracker = record("asc-default", {
      statuses: [{ id: "open", label: "OPEN", category: "open" }],
      fields: MIXED_FIELDS,
      defaultSort: { field: "plain" }
    });
    const [parsed] = readTrackers(context([tracker]));
    expect(parsed?.defaultSort?.direction).toBe("asc");
    expect(trackerDefinitionDiagnostics([tracker])).toEqual([]);
  });

  it("warns and keeps the list open when the declared field is missing or not sortable", () => {
    for (const field of ["ghost", "hiddenFilter", "visiblePlain"]) {
      const tracker = record("invalid", {
        statuses: [{ id: "open", label: "OPEN", category: "open" }],
        fields: MIXED_FIELDS,
        defaultSort: { field, direction: "asc" }
      });
      const [parsed] = readTrackers(context([tracker]));
      expect(parsed?.defaultSort).toBeUndefined();
      expect(trackerDefinitionDiagnostics([tracker]).map((item) => item.code))
        .toContain("TICKET_DEFAULT_SORT_INVALID");
      // 一覧そのものは開く。従来どおりタイトルの昇順へ戻る
      expect(ticketListView(context([tracker])).defaultSort)
        .toEqual({ columnId: "title", direction: "asc" });
    }
  });

  it("falls back to the title ascending when nothing is declared", () => {
    const view = ticketListView(context([mixed]));
    expect(view.defaultSort).toEqual({ columnId: "title", direction: "asc" });
  });
});
