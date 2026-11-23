// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createEditorAdapter } from "../packages/ui-react/src/editor/editor-adapter.js";

/**
 * 貼り付けXSS（GHSA-c8x8-7fp4-3x9w、prosemirror-view < 1.42.3）の回帰テスト。
 *
 * 本文エディタへHTMLを含む文字列を貼ったとき、`<img src=x onerror=...>`のような
 * イベントハンドラ属性が本文（保存されるCommonMark）と編集領域のDOMへ入らないことを確かめる。
 *
 * jsdomにはClipboardEvent/DataTransferが無いため、ブラウザのpasteイベントそのものは
 * 作れない。代わりにprosemirror-viewが`view.dom`（.ProseMirror）で受けるpasteイベントを
 * 合成し、fakeのclipboardDataを載せる。これで編集画面のpaste経路
 * （editHandlers.paste → doPaste → parseFromClipboard → スキーマ解析）がそのまま走る。
 */

const PAYLOAD_HTML =
  '<p>貼り付け確認<img src="x" onerror="alert(1)">' +
  '<a href="https://example.com" onclick="alert(1)" onmouseover="alert(2)">リンク</a>' +
  '<span style="color:red" onfocusin="alert(3)">装飾</span></p>';
const PAYLOAD_TEXT = "貼り付け確認リンク装飾";

describe("pasting HTML into the page body editor", () => {
  it("keeps event handler attributes out of the saved body", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const changes: string[] = [];
    const adapter = await createEditorAdapter(root, {
      value: "",
      onChange: (value) => changes.push(value),
      onFocus: () => undefined,
      onStateChange: () => undefined
    });
    try {
      const editable = root.querySelector<HTMLElement>(".milkdown .ProseMirror");
      expect(editable, "編集領域が生成されていません").toBeTruthy();

      const pasteData = {
        getData: (type: string) =>
          type === "text/html" ? PAYLOAD_HTML : type === "text/plain" ? PAYLOAD_TEXT : "",
        files: [] as File[]
      };
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: pasteData });
      editable!.dispatchEvent(event);
      // @milkdown/plugin-listenerはmarkdownUpdatedを200msのデバウンスで出すが、
      // 編集画面の保存経路も同じデバウンスを通るため、テストも同じだけ待つ。
      await new Promise((resolve) => setTimeout(resolve, 300));

      const markdown = adapter.getValue();
      // 貼り付け自体（HTMLをリッチ内容として解析・反映）が成功していることが、
      // 以下の属性検査を意味のあるものにする前提条件である。
      expect(markdown, "貼り付けたテキストが本文へ反映されません").toContain("貼り付け確認");
      expect(markdown, "貼り付けたリンクが本文へ反映されません").toContain("[リンク](https://example.com)");
      expect(changes.length, "onChangeが呼ばれていません").toBeGreaterThan(0);

      // イベントハンドラ等の属性が本文（保存されるCommonMark）へ残らないこと。
      for (const forbidden of ["onerror", "onclick", "onmouseover", "onfocusin", "color:red", "alert("]) {
        expect(markdown.toLowerCase(), `貼り付け後の本文に${forbidden}が含まれています`).not.toContain(forbidden);
        expect(editable!.innerHTML.toLowerCase(), `編集領域のDOMに${forbidden}が含まれています`).not.toContain(forbidden);
      }
    } finally {
      await adapter.destroy();
      root.remove();
    }
  });
});
