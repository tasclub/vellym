import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseGitDiff, foldDiff } from "../packages/ui-react/src/editor/git-diff-model.js";
import { historicalPage, HistoryDocument } from "../packages/ui-react/src/editor/git-history.js";
import { GitDiff } from "../packages/ui-react/src/editor/git-diff.js";
import { DocumentView } from "../packages/ui-react/src/editor/view.js";
import { i18next } from "../packages/ui-react/src/shared/i18n.js";
import type { PageView } from "@vellym-internal/core";

const current: PageView = {
  page: { apiVersion: "vellym.tasclub.com/v1", kind: "Page", metadata: { name: "sample", title: "Current" }, spec: { locale: "en", blocks: [] } },
  knownBlocks: [], relativePath: "sample.yaml", hash: "live", readOnly: false, readOnlyReasons: [], locale: "en", baseLocale: "en"
};
const source = `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: sample
  title: Old title
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: "**Historical body**"
  translations:
    ja:
      title: 過去の題名
      blocks:
        - id: body
          type: rich-text
          content: 過去の本文
`;
describe("Git history presentation", () => {
  it("hides the entry and ignores ?history in static mode", () => {
    vi.stubGlobal("window", { __VELLYM_STATIC__: { appBase: "https://example.invalid/", dataBase: "https://example.invalid/data" }, location: { search: "?history" } });
    try {
      const html = renderToStaticMarkup(React.createElement(HistoryDocument, { view: current }));
      expect(html).toContain("Current");
      expect(html).not.toContain("listbox");
      expect(html).not.toContain("<button");
    } finally { vi.unstubAllGlobals(); }
  });
  it("projects old YAML without borrowing live relations or changing the editor", () => {
    const past = historicalPage(source, current)!;
    expect(past.readOnly).toBe(true);
    expect(past.relations).toBeUndefined();
    expect(renderToStaticMarkup(React.createElement(DocumentView, { view: past }))).toContain("<strong>Historical body</strong>");
    expect(current.page.metadata.title).toBe("Current");
    expect(historicalPage(source, { ...current, locale: "ja" })?.page.metadata.title).toBe("過去の題名");
    expect(historicalPage(source, { ...current, locale: "fr" })).toBeUndefined();
  });
  it("rejects malformed, unsupported and excessive-alias YAML", () => {
    for (const invalid of ["[", source.replace("kind: Page", "kind: Folder"), source.replace("vellym.tasclub.com/v1", "unknown/v9"), source + "metadata: {}\n"]) expect(historicalPage(invalid, current)).toBeUndefined();
  });
  it("parses line numbers, ignores headers, and folds with exactly three context lines", () => {
    const diff = `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,22 +1,22 @@\n${Array.from({ length: 10 }, (_, i) => ` line${i}`).join("\n")}\n-old\n+new\n${Array.from({ length: 10 }, (_, i) => ` tail${i}`).join("\n")}\n`;
    const lines = parseGitDiff(diff);
    expect(lines).toHaveLength(22);
    expect(lines[10]).toEqual({ kind: "remove", old: 11, text: "old" });
    expect(lines[11]).toEqual({ kind: "add", next: 11, text: "new" });
    expect(foldDiff(lines).map((chunk) => [chunk.folded, chunk.lines.length])).toEqual([[true, 7], [false, 8], [true, 7]]);
  });
  it("renders semantic tables, symbols and translated empty/large-diff states", async () => {
    await i18next.changeLanguage("en");
    const html = renderToStaticMarkup(React.createElement(GitDiff, { source: "@@ -1 +1 @@\n-old\n+new\n", comparison: "old → new" }));
    expect(html).toContain('<th scope="row">1</th>');
    expect(html).toContain("Added"); expect(html).toContain("Removed"); expect(html).toContain("+1 −1");
    expect(renderToStaticMarkup(React.createElement(GitDiff, { source: "", comparison: "same" }))).toContain("There are no differences");
    const large = renderToStaticMarkup(React.createElement(GitDiff, { source: `@@ -0,0 +1,2001 @@\n${"+line\n".repeat(2001)}`, comparison: "large" }));
    expect(large).toContain("Large diff"); expect(large).not.toContain("<table");
    await i18next.changeLanguage("ja");
    expect(renderToStaticMarkup(React.createElement(GitDiff, { source: "", comparison: "same" }))).toContain("この2つの版に違いはありません。");
  });
});
