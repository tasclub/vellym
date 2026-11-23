import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("document tree bulk-action toolbar", () => {
  it("keeps both localized actions on one quiet, keyboard-focusable row", () => {
    const css = readFileSync(
      "packages/ui-react/src/shell/document-tree.module.css",
      "utf8"
    );
    const source = readFileSync(
      "packages/ui-react/src/shell/document-tree.tsx",
      "utf8"
    );

    expect(css).toMatch(/\.treeToolbarButton\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s);
    expect(css).toContain("color: var(--text-muted);");
    expect(css).toContain(".treeToolbarButton[data-focus-visible]");
    expect(source).toContain('t("tree.expandAll")');
    expect(source).toContain('t("tree.collapseAll")');
    expect(source).toMatch(/<Button[\s\S]*?tree\.expandAll[\s\S]*?<\/Button>/);
    expect(source).toMatch(/<Button[\s\S]*?tree\.collapseAll[\s\S]*?<\/Button>/);
  });
});
