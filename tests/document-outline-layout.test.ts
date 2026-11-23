import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("document outline layout contract", () => {
  it("does not reserve the removed action column or apply ineffective ellipsis", () => {
    const css = readFileSync(
      "packages/ui-react/src/shell/document-outline.module.css",
      "utf8"
    );
    expect(css).not.toContain("grid-template-columns: minmax(0, 1fr) 28px");
    expect(css).not.toContain("text-overflow: ellipsis");
    expect(css).toContain(".item a {\n  display: block;");
  });

  it("shows both compact and full outlines only when headings exist", () => {
    const shell = readFileSync(
      "packages/ui-react/src/shell/workspace-shell.tsx",
      "utf8"
    );
    expect(shell.match(/props\.headings\.length > 0 &&/g)).toHaveLength(2);
  });
});
