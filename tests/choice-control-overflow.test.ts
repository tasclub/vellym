import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

function rule(path: string, selector: string): string {
  const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(css);
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1] ?? "";
}

it("allows document actions and segmented controls to fit narrow headers", () => {
  const header = rule("packages/ui-react/src/editor/view.module.css", ".document-header");
  const actions = rule("packages/ui-react/src/editor/view.module.css", ".document-header-actions");
  const segments = rule("packages/ui-react/src/shared/choice-control.module.css", ".segments");
  expect(header).toMatch(/flex-wrap:\s*wrap/);
  expect(actions).toMatch(/flex:\s*0 1 auto/);
  expect(actions).toMatch(/min-width:\s*0/);
  expect(actions).toMatch(/max-width:\s*100%/);
  expect(segments).toMatch(/flex-wrap:\s*wrap/);
  expect(segments).toMatch(/max-width:\s*100%/);
});
