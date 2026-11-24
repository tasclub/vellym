import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect } from "vitest";
import { extractFileLinks } from "@vellym-internal/core";
import { diagnoseFileLinks, loadConfig, loadRepository } from "@vellym-internal/runtime-node";

describe("relative file links", () => {
  it("extracts links and reference links, excluding images, code, URLs and wiki links", () => {
    expect(extractFileLinks('[a](a.md#x) [b][id] ![img](x.png) [web](https://example.org) [mail](mailto:a) [anchor](#a) [root](/a) [[name]] ` [x](code.md) `\n\n[id]: b.md')).toEqual(["a.md#x", "b.md"]);
  });
  it("checks base and translated links without accessing external symlinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-file-links-"));
    const outside = await mkdtemp(path.join(tmpdir(), "vellym-file-outside-"));
    try {
      await mkdir(path.join(root, "content"));
      await mkdir(path.join(root, "content", "folder"));
      await writeFile(path.join(root, "content", "a b.md"), "ok");
      await symlink(outside, path.join(root, "content", "escape"));
      await symlink(path.join(outside, "missing"), path.join(root, "content", "dangling"));
      const configPath = path.join(root, "vellym.config.yaml");
      await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
      await writeFile(path.join(root, "content", "page.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: page
  title: Test
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: '[ok](a%20b.md#part) [dir](folder?x) [bad](missing.md) [external](escape/no/child) [dangling](dangling) [outside](../../not-here) ![image](missing.png) [[name]]'
  translations:
    ja:
      title: 試験
      blocks:
        - id: body
          type: rich-text
          content: '[bad](missing-ja.md)'
`);
      const config = await loadConfig(configPath);
      const snapshot = await loadRepository(config.contentRoot);
      const diagnostics = await diagnoseFileLinks(config, snapshot);
      expect(diagnostics).toMatchObject([
        { code: "BROKEN_FILE_LINK", severity: "warning", path: "/spec/blocks/0/content" },
        { code: "BROKEN_FILE_LINK", path: "/spec/translations/ja/blocks/0/content" }
      ]);
      const run = promisify(execFile);
      const args = ["packages/vellym/dist/cli.mjs", "validate", "--config", configPath, "--json"];
      const result = await run(process.execPath, args);
      expect(JSON.parse(result.stdout).diagnostics.filter((d: {code: string}) => d.code === "BROKEN_FILE_LINK")).toHaveLength(2);
      await expect(run(process.execPath, [...args, "--strict"])).rejects.toMatchObject({ code: 1 });
      const build = await run(process.execPath, ["packages/vellym/dist/cli.mjs", "build", "--config", configPath, "--json"]);
      expect(JSON.parse(build.stdout).diagnostics.some((d: {code: string}) => d.code === "BROKEN_FILE_LINK")).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
});
