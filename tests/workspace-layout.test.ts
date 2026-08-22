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

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
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
});
