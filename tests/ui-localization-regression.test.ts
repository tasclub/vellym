import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

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

const guardedUiFiles = [
  ...localizedUiLiterals.map(({ file }) => file),
  "packages/ui-react/src/shared/api.ts"
];
const japaneseText = /[ぁ-んァ-ン一-龯]/;
const editorTableLabels = [
  "editor.tableRowAdd",
  "editor.tableRowRemove",
  "editor.tableColAdd",
  "editor.tableColRemove",
  "editor.tableRemove"
];

function hardCodedJapaneseText(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const findings: string[] = [];
  const visit = (node: ts.Node): void => {
    const isVisibleLiteral = ts.isStringLiteralLike(node) || ts.isJsxText(node) ||
      ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (isVisibleLiteral && japaneseText.test(node.text)) {
      const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
      findings.push(`${line}: ${node.text.trim()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return findings;
}

describe("UI localization regression guard", () => {
  for (const { file, literals } of localizedUiLiterals) {
    it(`keeps translated UI text out of hard-coded strings in ${file}`, () => {
      const source = readFileSync(file, "utf8");
      for (const literal of literals) expect(source).not.toContain(literal);
    });
  }

  for (const file of guardedUiFiles) {
    it(`does not add hard-coded Japanese UI text to ${file}`, () => {
      expect(hardCodedJapaneseText(file)).toEqual([]);
    });
  }

  it("has Japanese and English labels for every table operation", () => {
    for (const locale of ["ja", "en"]) {
      const dictionary = JSON.parse(
        readFileSync(`packages/ui-react/src/locales/${locale}.json`, "utf8")
      ) as Record<string, string>;
      for (const key of editorTableLabels) {
        expect(dictionary[key]?.trim(), `${locale}:${key}`).toBeTruthy();
      }
    }
    const source = readFileSync("packages/ui-react/src/editor/editor-workspace.tsx", "utf8");
    expect(source).toContain("aria-label={t(action.labelKey)}");
    expect(source).toContain("title={t(action.labelKey)}");
  });
});
