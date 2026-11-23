import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PageView } from "@vellym-internal/core";
import type { PluginViewPayload } from "../packages/ui-react/src/plugin/plugin-list-view.js";
import {
  PluginDetailPanel,
  PluginListPage
} from "../packages/ui-react/src/plugin/plugin-area.js";

/**
 * プラグインの画面の文字列は、文書の要求言語ではなく**UI言語**で選ぶ。
 *
 * 2026-11-06の実機確認で、設定画面からUI言語をEnglishにしても
 * 一覧・カンバン・WBS・Tracker設定・チケット詳細の診断が日本語のままだった。
 * 原因は、ブラウザ側がプラグインへ`view.locale`（文書の要求言語）を
 * 渡していたことである。ここは`uiLocale`を渡す、という規則をテストで止める。
 *
 * 下のfixtureは`view`を日本語（`/ja/`のページ）に固定し、UI言語だけ変えている。
 * 文書の言語を変えてもプラグインの文字列はUI言語のまま、という受入条件の
 * 片方（ページは日本語・UIは英語）をそのまま見ている。
 */

/** `/ja/`で開いたページ。UI言語の設定とは無関係に日本語のままである */
function jaPageView(): PageView {
  return {
    page: {
      apiVersion: "vellym.tasclub.com/v1",
      kind: "TicketTracker",
      metadata: { name: "tracker", title: "Tracker" },
      spec: {}
    },
    knownBlocks: [],
    relativePath: "tracker.yaml",
    hash: "hash",
    readOnly: false,
    readOnlyReasons: [],
    locale: "ja",
    requestedLocale: "ja",
    baseLocale: "ja",
    availableLocales: ["ja"],
    editableLocales: ["ja"],
    isBaseLocale: true
  } as unknown as PageView;
}

const listPayload = {
  pluginId: "tickets",
  viewId: "tickets.list",
  descriptor: {
    type: "list",
    id: "tickets.list",
    kind: "Page",
    title: { ja: "チケット一覧", en: "Tickets" },
    columns: [
      { id: "status", label: { ja: "状態", en: "Status" }, type: "text", path: ["status"] }
    ],
    emptyState: { message: { ja: "チケットがありません", en: "No tickets" } }
  },
  rows: [
    { name: "ticket-1", title: "_first_ ticket", relativePath: "a.yaml", values: { status: "doing" } }
  ],
  allRows: [
    { name: "ticket-1", title: "first ticket", relativePath: "a.yaml", values: { status: "doing" } }
  ],
  commands: [{ id: "tickets.create", title: { ja: "チケットを作成", en: "New ticket" } }]
} as unknown as PluginViewPayload;

const detailPayload = {
  pluginId: "tickets",
  viewId: "tickets.detail",
  descriptor: {
    type: "detail",
    id: "tickets.detail",
    kind: "Page",
    body: "blocks",
    fields: [
      {
        id: "status",
        label: { ja: "状態", en: "Status" },
        type: "select",
        path: ["status"],
        options: [{ value: "doing", label: { ja: "対応中", en: "Doing" } }]
      }
    ]
  },
  rows: [],
  allRows: [],
  commands: [],
  target: { name: "ticket-1", title: "first ticket", relativePath: "a.yaml", values: {} },
  targetDiagnostics: [
    { code: "TYPE_MISMATCH", message: { ja: "型が不正です", en: "Invalid type" }, path: "/status" }
  ]
} as unknown as PluginViewPayload;

function listMarkup(uiLocale: string): string {
  return renderToStaticMarkup(createElement(PluginListPage, {
    payload: listPayload,
    view: jaPageView(),
    projectRoot: "/projects/demo",
    targetName: "tracker",
    uiLocale,
    showAll: false,
    onToggleShowAll: () => {},
    onNavigate: () => {},
    onSwitchView: () => {},
    onRunCommand: () => {},
    editable: true,
    onBulkChange: async () => [],
    onBulkArchive: async () => []
  }));
}

function detailMarkup(uiLocale: string): string {
  return renderToStaticMarkup(createElement(PluginDetailPanel, {
    payload: detailPayload,
    view: jaPageView(),
    uiLocale,
    // 編集モードにすると選択肢の表示名も描かれる。診断はモードに関係なく出る。
    editing: true,
    onChange: () => undefined,
    onSave: async () => undefined
  }));
}

describe("プラグインの画面はUI言語で文字列を選ぶ", () => {
  it("一覧のボタン・見出し・列名はUI言語がEnglishなら英語になる", () => {
    const markup = listMarkup("en");
    expect(markup).toContain("New ticket");
    expect(markup).toContain("Status");
    expect(markup).toContain("Tickets");
    expect(markup).not.toContain("チケットを作成");
    expect(markup).not.toContain("状態");
  });

  it("一覧はUI言語が日本語なら日本語のまま", () => {
    const markup = listMarkup("ja");
    expect(markup).toContain("チケットを作成");
    expect(markup).toContain("状態");
    expect(markup).not.toContain("New ticket");
  });

  it("詳細の項目名・選択肢・診断の本文はUI言語がEnglishなら英語になる", () => {
    const markup = detailMarkup("en");
    expect(markup).toContain("Invalid type");
    expect(markup).toContain("Status");
    expect(markup).toContain("Doing");
    expect(markup).not.toContain("型が不正です");
    expect(markup).not.toContain("対応中");
  });

  it("詳細はUI言語が日本語なら日本語のまま", () => {
    const markup = detailMarkup("ja");
    expect(markup).toContain("型が不正です");
    expect(markup).toContain("状態");
    expect(markup).not.toContain("Invalid type");
  });
});

/**
 * 上のテストは部品にuiLocaleを渡せば英語になることを見る。
 * ここでは、実際の配線が`view.locale`（文書の要求言語）に戻っていないことを
 * ソース確認で止める（`tests/ui-components.test.ts`とおなじ手法）。
 * 2026-11-06の不具合は、部品が正しくても`app.tsx`が文書の言語を渡していたことで起きていた。
 */
describe("プラグインへUI言語を渡す配線", () => {
  const appSource = readFileSync("packages/ui-react/src/shell/app.tsx", "utf8");
  const areaSource = readFileSync("packages/ui-react/src/plugin/plugin-area.tsx", "utf8");

  it("app.tsxはカンバン・WBS・Tracker設定のcontext.localeにUI言語を渡す", () => {
    expect(appSource).toMatch(
      /createRenderContext\(\{[^{}]*locale: bootstrap\.project\.uiLocale/s
    );
  });

  it("app.tsxは一覧と詳細のパネルへuiLocaleを渡す", () => {
    expect(appSource).toMatch(/<PluginListPage[\s\S]{0,600}?uiLocale=\{bootstrap\.project\.uiLocale\}/);
    expect(appSource).toMatch(/<PluginDetailPanel[\s\S]{0,600}?uiLocale=\{bootstrap\.project\.uiLocale\}/);
  });

  it("app.tsxはプラグインの画面へ文書の要求言語を戻さない", () => {
    expect(appSource).not.toMatch(/locale=\{view\.locale/);
    expect(appSource).not.toMatch(/locale: view\.locale/);
    expect(appSource).not.toMatch(/createRenderContext\(\{[^{}]*locale[,}]/s);
  });

  it("プラグインのコマンド実行（新規チケットの既定の題名）は文書の要求言語のまま", () => {
    // 題名はYAMLへ保存する文書の内容なので、UI言語ではなく要求言語で決まる。
    expect(appSource).toContain("locale: requestedLocale ?? bootstrap.project.requestedLocale");
  });

  it("plugin-area.tsxはPluginListViewとPluginDetailViewへuiLocaleを渡す", () => {
    const uiLocaleProps = areaSource.match(/locale=\{props\.uiLocale\}/g) ?? [];
    // コマンドの選択肢、一覧、詳細の3箇所。
    expect(uiLocaleProps.length).toBe(3);
    expect(areaSource).not.toMatch(/locale=\{(?:view|props\.view)\.locale/);
  });
});
