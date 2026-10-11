import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const localizedUiLiterals: Array<{ file: string; literals: string[] }> = [
  {
    file: "packages/ui-react/src/shell/app.tsx",
    literals: [
      "Vellymを読み込んでいます…",
      "もう一度試す",
      "設定を読み込めません",
      "設定ファイルを確認してください",
      "リソースを開けません",
      "リソースが見つかりません:"
    ]
  },
  {
    file: "packages/ui-react/src/shell/sidebar.tsx",
    literals: ["ページ一覧", "診断 "]
  },
  {
    file: "packages/ui-react/src/editor/editor-workspace.tsx",
    literals: ["＋行", "−行", "＋列", "−列", "表を削除"]
  },
  {
    file: "packages/ui-react/src/plugin/render-context.ts",
    literals: ["静的出力では保存できません"]
  }
];

describe("UI localization regression guard", () => {
  for (const { file, literals } of localizedUiLiterals) {
    it(`keeps translated UI text out of hard-coded strings in ${file}`, () => {
      const source = readFileSync(file, "utf8");
      for (const literal of literals) expect(source).not.toContain(literal);
    });
  }
});
