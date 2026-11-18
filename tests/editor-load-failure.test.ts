import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorWorkspace } from "../packages/ui-react/src/editor/editor-workspace.js";
import "../packages/ui-react/src/shared/i18n.js";

/**
 * 最初の読み込みに失敗すると、表示中のページが無いまま app.tsx が loadError を
 * 渡してくる（message はほかの通知にも使うので見ない）。読み込み中のまま止めず、失敗を知らせる（ticket-01m7phrktc68mgpwwfpznepmrz）。
 */
function render(loadError: string, message = ""): string {
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(EditorWorkspace, {
    title: "", slug: "", blocks: [], pages: [], editing: false, canEdit: false, editReasons: [],
    blockAssessments: [], saveState: "idle", hasUnsavedChanges: false, message, loadError, saveError: "",
    copyMessage: "", watchConnection: { state: "connected" }, watchMessage: "", externalChange: false,
    onStartEdit: noop, onCancel: noop, onTitleChange: noop, onSlugChange: noop, onBlockChange: noop,
    onSave: noop, onRetry: noop, onCopy: noop, onKeepDraft: noop, onReload: noop,
    onRenameFile: async () => undefined
  } as unknown as Parameters<typeof EditorWorkspace>[0]));
}

describe("EditorWorkspace without a view", () => {
  it("shows the load error as an alert instead of the loading text", () => {
    const html = render("静的データを解析できませんでした。");
    expect(html).toContain('role="alert"');
    expect(html).toContain("静的データを解析できませんでした。");
    expect(html).not.toContain("Pageを読み込んでいます");
    expect(html).not.toContain("Loading");
  });

  it("keeps the loading text while nothing has failed, even with other notices", () => {
    const html = render("", "読み込めない文書があります。");
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('class="empty"');
  });
});
