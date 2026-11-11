import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * 同じ行に文字ボタンと記号ボタンを並べる画面は多い。そこに高さの差があると
 * 行が波打って見える。実際、チケット管理の設定画面の操作列は
 * 「削除」が39px、「↑ ↓」が34pxだった。
 *
 * 原因は高さの作り方にある。上下の余白で高さを作ると、`styles.css`の
 * `button { font: inherit; }`で受け継いだ`line-height`の分行が余白に足される。
 * 置く場所（本文の面・一覧・ツールバー）で`line-height`が違うので、
 * 同じ文言でも高さが変わる。
 *
 * そこで**高さは罫を含むmin-heightで作る**ことをここで固定する。
 */
const buttonCss = readFileSync(
  "packages/ui-react/src/shared/button.module.css",
  "utf8"
);

/** セレクタに一致する規則の中身（宣言だけ）を返す。 */
function declarations(css: string, selector: string): string {
  // 規則の直前にはコメントが続くことがある。コメントを除いて行頭から見る
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(source);
  if (!rule) throw new Error(`規則が見つかりません: ${selector}`);
  return rule[1] ?? "";
}

/** `padding` shorthandの上下成分。4値・3値・2値・1値をまとめて見る。 */
function verticalPadding(block: string): string | null {
  const shorthand = /(?:^|;)\s*padding\s*:\s*([^;]+)/.exec(block)?.[1]?.trim();
  if (shorthand) return shorthand.split(/\s+/)[0] ?? null;
  const blockStart = /(?:^|;)\s*padding-block(?:-start)?\s*:\s*([^;]+)/.exec(block)?.[1];
  return blockStart?.trim() ?? null;
}

function hasFixedHeight(block: string): boolean {
  return /(?:^|;)\s*height\s*:/.test(block);
}

describe("shared button height", () => {
  it("builds the height from min-height, not from vertical padding", () => {
    const button = declarations(buttonCss, ".button");
    expect(button).toMatch(/min-height:\s*34px/);
    expect(verticalPadding(button)).toBe("0");
    // 折り返した長い文言で文字が切れないように、固定の高さは書かない
    expect(hasFixedHeight(button)).toBe(false);
  });

  it("fixes line-height so the height does not depend on the place", () => {
    const button = declarations(buttonCss, ".button");
    expect(button).toMatch(/(?:^|;)\s*line-height\s*:\s*[0-9.]+/);
  });

  it("keeps icon buttons at least as wide as they are tall", () => {
    const icon = declarations(buttonCss, ".icon");
    expect(icon).toMatch(/min-width:\s*34px/);
    expect(verticalPadding(icon)).toBe("0");
  });

  it("leaves the editor toolbar at its own 32px", () => {
    /*
     * ツールバーのボタンは`min-width`や`min-height`を32pxにしている。
     * 共通部品の高さを34pxへ揃えても、祖先クラス付きセレクタ（詳細度0,1,1）が
     * `.button`（0,1,0）に勝つので、ツールバーは今の寸法のまま残る。
     */
    const toolbarCss = readFileSync(
      "packages/ui-react/src/editor/editor-workspace.module.css",
      "utf8"
    );
    for (const selector of [".history-actions button", ".format-actions button"]) {
      expect(declarations(toolbarCss, selector)).toMatch(/min-height:\s*32px/);
    }
  });

  it("detects the shape it is looking for", () => {
    // 効かない検査を置いても意味が無い。昔の高さの作り方を拾えることを確かめる
    const before = "min-height: 34px; padding: var(--space-2) var(--space-4);";
    expect(verticalPadding(before)).toBe("var(--space-2)");
    expect(hasFixedHeight(before)).toBe(false);
    expect(hasFixedHeight("height: 34px; padding: 0 16px;")).toBe(true);
  });
});
