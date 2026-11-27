import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { cliPath } from "../fixtures.js";

// CORE-MANUAL-E04 (Core手動受入シナリオ): how `vellym` finds the config without --config.
// CLI only; no browser is needed.
const vellym = (cwd: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

test("validate finds docs/vellym.config.yaml from the project root and docs/, and stops on two candidates @CORE-MANUAL-E04", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vellym-core-e04-")));
  try {
    const init = vellym(root, "init", "--language", "ja");
    expect(init.status, init.output).toBe(0);
    // A Page that exists only under docs/ proves which config was used.
    await writeFile(path.join(root, "docs/e04.yaml"),
      "apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata: { name: e04-marker, title: E04 }\nspec:\n  locale: ja\n  blocks:\n    - { id: body, type: rich-text, content: \"設定の探し方\" }\n");

    const fromRoot = vellym(root, "validate");
    expect(fromRoot.status, fromRoot.output).toBe(0);
    expect(fromRoot.output).toContain("2ページ");

    const fromDocs = vellym(path.join(root, "docs"), "validate");
    expect(fromDocs.status, fromDocs.output).toBe(0);
    expect(fromDocs.output).toContain("2ページ");

    await mkdir(path.join(root, "vellym"));
    await copyFile(path.join(root, "docs/vellym.config.yaml"), path.join(root, "vellym/vellym.config.yaml"));
    const ambiguous = vellym(root, "validate");
    expect(ambiguous.status, ambiguous.output).toBe(2);
    expect(ambiguous.output).toContain(path.join(root, "docs/vellym.config.yaml"));
    expect(ambiguous.output).toContain(path.join(root, "vellym/vellym.config.yaml"));
    expect(ambiguous.output).toContain("--config");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
