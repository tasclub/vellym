import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellCss = readFileSync(
  "packages/ui-react/src/shell/workspace-shell.module.css",
  "utf8"
);

describe("empty document outline desktop width", () => {
  it("collapses only the non-admin desktop outline track when no outline is rendered", () => {
    expect(shellCss).toMatch(
      /@media \(min-width: 1280px\) \{\s*\.shell:not\(\.adminShell\):not\(:has\(\.outlineColumn\)\) \{\s*grid-template:\s*"rail header header header" 54px\s*"rail navigation content outline" minmax\(0, 1fr\)\s*\/ 52px var\(--navigation-width\) minmax\(0, 1fr\) 0;\s*}\s*}/
    );
    expect(shellCss).toContain(
      ".adminShell {\n  grid-template:\n    \"rail header header\" 54px"
    );
  });
});
