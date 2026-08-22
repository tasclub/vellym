import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(
    process.cwd(),
    "packages/ui-react/src/shell/workspace-shell.module.css"
  ),
  "utf8"
);
const globalSource = readFileSync(
  path.join(process.cwd(), "packages/ui-react/src/styles.css"),
  "utf8"
);

function declarations(selector: string, css = source): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("workspace scroll containers", () => {
  it("keeps the viewport shell out of the scroll chain", () => {
    const shell = declarations(".shell");

    expect(shell).toMatch(/height:\s*100dvh/);
    expect(shell).toMatch(/overflow:\s*clip/);
    expect(shell).not.toMatch(/overflow:\s*(?:auto|scroll|hidden)/);
  });

  it("scrolls the tall desktop regions inside the viewport shell", () => {
    expect(declarations(".navigation")).toMatch(/overflow:\s*auto/);
    expect(declarations(".content")).toMatch(/overflow:\s*auto/);
    expect(declarations(".outlineColumn")).toMatch(/overflow:\s*auto/);
  });

  it("anchors screen-reader-only content without using its static position", () => {
    const visuallyHidden = declarations(".visually-hidden", globalSource);

    // CSS契約だけを固定する。jsdomはレイアウトしないため、documentの
    // scrollHeightがclientHeightと一致することまではこのテストで担保できない。
    expect(visuallyHidden).toMatch(/position:\s*absolute/);
    expect(visuallyHidden).toMatch(/inset-block-start:\s*0/);
    expect(visuallyHidden).toMatch(/inset-inline-start:\s*0/);
    expect(visuallyHidden).toMatch(/width:\s*1px/);
    expect(visuallyHidden).toMatch(/height:\s*1px/);
    expect(visuallyHidden).toMatch(/overflow:\s*hidden/);
    expect(visuallyHidden).toMatch(/clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
    expect(visuallyHidden).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(visuallyHidden).not.toMatch(/margin:\s*-[^;]+/);
    expect(visuallyHidden).not.toMatch(/display:\s*none/);
    expect(visuallyHidden).not.toMatch(/visibility:\s*hidden/);
  });
});
