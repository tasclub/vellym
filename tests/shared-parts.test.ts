import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const uiRoot = path.join(process.cwd(), "packages/ui-react/src");

function files(extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(uiRoot, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(extension)) {
      found.push(path.join(entry.parentPath, entry.name));
    }
  }
  return found.sort();
}

function relative(file: string): string {
  return path.relative(process.cwd(), file);
}

/**
 * 共通部品と同じものを、画面ごとに作り直していないか。
 *
 * **これが元の問題である。** 本来の部品があるのに、画面ごとの独自要素で
 * 新しいボタンを作ってしまう。実際に`admin-view`が`.panel button`へ
 * 寸法・罫・地を書いて、共通のButtonと同じものを別に作っていた。
 *
 * 見た目が違うこと自体は悪くない。パンくずやページ送りは**違う操作**なので
 * 違う形でよい。悪いのは「同じものを作り直す」ことである。そこで、
 * 標準ボタンの見た目を構成する3点（最低高さ・罫・地）が**揃って**
 * 指定されている規則を、作り直しの疑いとして検出する。
 */
const REMAKES_A_BUTTON = /[^{}]*button[^{}]*\{[^{}]*\}/g;

function looksLikeARemadeButton(rule: string): boolean {
  const hasHeight = /min-height/.test(rule);
  const hasBorder = /border\s*:\s*(?!0)(?!none)/.test(rule);
  const hasBackground = /background\s*:\s*(?!transparent)(?!none)/.test(rule);
  return hasHeight && hasBorder && hasBackground;
}

/**
 * 見た目が違ってよい操作。**ボタンの作り直しではない。**
 *
 * ここへ足すときは、なぜ共通のButtonでは合わないのかを書く。理由なく
 * 伸びるなら、それは作り直しが増えている合図である。
 */
const DIFFERENT_AFFORDANCES = [
  // 前後移動。56pxの2行組みで、題名と方向を縦に並べる領域そのものが操作になる
  ".pageTurner button",
  // メニューの項目。行として並ぶものであり、押せる四角ではない
  ".more-menu button"
];

describe("shared parts", () => {
  it("is not re-implemented screen by screen", () => {
    const offenders: string[] = [];
    for (const file of [...files(".css")]) {
      // 共通部品そのものは、当然その見た目を持つ
      if (file.includes(`${path.sep}shared${path.sep}`)) continue;
      const source = readFileSync(file, "utf8");
      for (const rule of source.match(REMAKES_A_BUTTON) ?? []) {
        const selector = rule.split("{")[0]?.trim() ?? "";
        if (!looksLikeARemadeButton(rule)) continue;
        if (DIFFERENT_AFFORDANCES.some((allowed) => selector.includes(allowed))) continue;
        offenders.push(`${relative(file)}: ${selector}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("detects the shape it is looking for", () => {
    // 効かない検査を置いても意味が無い。
    expect(
      looksLikeARemadeButton(
        ".panel button { min-height:38px; border:1px solid #ccc; background:#fff; }"
      )
    ).toBe(true);
    // パンくずのようなリンク状のボタンは、作り直しではない
    expect(
      looksLikeARemadeButton(
        ".breadcrumbs button { padding: 4px; border: 0; background: transparent; }"
      )
    ).toBe(false);
  });

  it("keeps dialogs on the shared part", () => {
    /*
     * 素の`div`へ`role="dialog"`と書いても、焦点の閉じ込めもEscapeも
     * 効かない。**属性は宣言であって振る舞いではない。**
     * 実際にそう書かれた自前モーダルがあり、キーボードで背後へ抜けていた。
     */
    const offenders = files(".tsx")
      .filter((file) => !file.includes(`${path.sep}shared${path.sep}`))
      .filter((file) => /role="dialog"/.test(readFileSync(file, "utf8")))
      .map(relative);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("keeps data tables on the shared part", () => {
    /*
     * 並べ替え・`aria-sort`・横スクロール・選択列を各画面で書き直すと、
     * 必ず品質が落ちる。
     *
     * `view.tsx`だけは例外である。**利用者が本文に書いた表**を描く場所で、
     * 列と行のモデルを持たないため`DataTable`が当てはまらない。
     */
    const allowed = new Set([path.join("packages", "ui-react", "src", "editor", "view.tsx")]);
    const offenders = files(".tsx")
      .filter((file) => !file.includes(`${path.sep}shared${path.sep}`))
      .filter((file) => /<table/.test(readFileSync(file, "utf8")))
      .map(relative)
      .filter((file) => !allowed.has(file));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
