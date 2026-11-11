import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PageView } from "@vellym-internal/core";
import { EditorWorkspace } from "../packages/ui-react/src/editor/editor-workspace.js";
import { PluginDetailPanel } from "../packages/ui-react/src/plugin/plugin-area.js";
import type { PluginViewPayload } from "../packages/ui-react/src/plugin/plugin-list-view.js";

/**
 * チケットを作成した直後の画面に、プラグインが宣言した項目（ステータスと
 * trackerの項目）が出ていることを確かめる。
 *
 * 作成直後は編集セッション（localeDrafts）を持たない下書きとして開く。
 * 面の既定値が「正本の言語と一致する locale」を持たないと、
 * 項目を出す面との照合が偽になり、項目欄がどこにも描画されない。
 */

function draftPageView(locale: string): PageView {
  return {
    page: {
      apiVersion: "vellym.tasclub.com/v1",
      kind: "Page",
      metadata: { name: "draft-1", title: "新規チケット" },
      spec: { fields: {} }
    },
    knownBlocks: [],
    relativePath: "content/main/draft-1.yaml",
    // 未保存下書きの番兵（app.tsxのpendingPageViewと同じ）。
    hash: "",
    readOnly: false,
    readOnlyReasons: [],
    locale,
    requestedLocale: locale,
    baseLocale: locale,
    availableLocales: [locale],
    editableLocales: [locale],
    isBaseLocale: true
  } as PageView;
}

const detailPayload = {
  pluginId: "tickets",
  viewId: "tickets.detail",
  descriptor: {
    type: "detail",
    id: "tickets.detail",
    kind: "page",
    body: "blocks",
    fields: [
      {
        id: "status",
        label: { ja: "ステータス", en: "Status" },
        type: "select",
        path: ["status"],
        options: [
          { value: "doing", label: { ja: "対応中", en: "Doing" } }
        ]
      },
      {
        id: "priority",
        label: { ja: "優先度", en: "Priority" },
        type: "select",
        path: ["fields", "priority"],
        options: [
          { value: "high", label: { ja: "高", en: "High" } }
        ]
      },
      {
        id: "owner",
        label: { ja: "担当", en: "Assignee" },
        type: "text",
        path: ["fields", "owner"]
      }
    ]
  },
  rows: [],
  allRows: [],
  commands: []
} as unknown as PluginViewPayload;

function render(props: {
  view: PageView;
  editLocale?: string;
  localeDrafts?: Array<{ locale: string; title: string; blocks: never[] }>;
}): string {
  return renderToStaticMarkup(
    createElement(EditorWorkspace, {
      view: props.view,
      // 編集作業中の草稿。実画面では編集セッションから作られるが、
      // 面の切り出しと項目欄の条件だけを見るのでviewと同じもので足りる。
      draft: props.view,
      beforeBody: createElement(PluginDetailPanel, {
        payload: detailPayload,
        view: props.view,
        uiLocale: "ja",
        editing: true,
        onChange: () => undefined,
        onSave: async () => undefined
      }),
      title: "新規チケット",
      slug: "draft-1",
      blocks: [],
      pages: [],
      editing: true,
      canEdit: true,
      editReasons: [],
      blockAssessments: [],
      saveState: "dirty",
      hasUnsavedChanges: true,
      message: "",
      saveError: "",
      copyMessage: "",
      watchConnection: { state: "connected" },
      watchMessage: "",
      externalChange: false,
      onStartEdit: () => undefined,
      onCancel: () => undefined,
      onTitleChange: () => undefined,
      onSlugChange: () => undefined,
      onBlockChange: () => undefined,
      onSave: () => undefined,
      onRetry: () => undefined,
      onCopy: () => undefined,
      onKeepDraft: () => undefined,
      onReload: () => undefined,
      onRenameFile: async () => undefined,
      ...(props.editLocale ? { editLocale: props.editLocale } : {}),
      ...(props.localeDrafts ? { localeDrafts: props.localeDrafts } : {})
    })
  );
}

describe("作成直後の下書きの面にプラグインの項目を出す", () => {
  it("編集セッションが無い下書きの面に、ステータスと項目の入力欄がある", () => {
    // 一覧・Kanban・WBSの作成ボタン直後の画面。`editLocale`も`localeDrafts`も無い。
    const html = render({ view: draftPageView("ja") });
    // 項目欄そのもの。項目idを直接数えないで、レンダラの実装を辿る。
    expect(html).toContain("plugin-detail");
    expect(html).toContain('id="plugin-field-status"');
    expect(html).toContain('id="plugin-field-priority"');
    expect(html).toContain('id="plugin-field-owner"');
    expect(html).toContain("ステータス");
    expect(html).toContain("優先度");
    expect(html).toContain("担当");
    // 面は表示状態で存在する（hiddenの下書き面に入っていない）。
    expect(html).toContain('id="locale-editor-panel"');
  });

  it("既存Pageの正本言語の編集面では従来どおり項目欄がある", () => {
    const html = render({
      view: draftPageView("ja"),
      editLocale: "ja",
      localeDrafts: [{ locale: "ja", title: "新規チケット", blocks: [] }]
    });
    expect(html).toContain('id="plugin-field-status"');
    expect(html).toContain('id="plugin-field-priority"');
    expect(html).toContain("優先度");
  });

  it("翻訳面の編集では項目欄を出さない（項目は正本の言語の面だけ）", () => {
    const html = render({
      view: draftPageView("ja"),
      editLocale: "en",
      localeDrafts: [
        { locale: "ja", title: "新規チケット", blocks: [] },
        { locale: "en", title: "New ticket", blocks: [] }
      ]
    });
    expect(html).not.toContain('id="plugin-field-status"');
    expect(html).not.toContain('id="plugin-field-priority"');
  });

  it("baseLocaleの無い通常Pageの下書きでも項目欄は出る", () => {
    const view = { ...draftPageView("ja"), baseLocale: undefined } as PageView;
    const html = render({ view });
    expect(html).toContain('id="plugin-field-status"');
    expect(html).toContain('id="plugin-field-priority"');
  });
});
