import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { extractAssetReferences, validateConfig } from "@vellym-internal/core";
import { diagnoseAssets, loadConfig, loadRepository, readAsset, saveAsset, startDevServer } from "@vellym-internal/runtime-node";
import { assetUrlTransform } from "../packages/ui-react/src/editor/asset-url.js";

// Small real PNG, plus signatures for the other accepted formats.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const images = [
  ["png", "image/png", png],
  ["jpg", "image/jpeg", Buffer.from([255, 216, 255, 224])],
  ["gif", "image/gif", Buffer.from("GIF89a")],
  ["webp", "image/webp", Buffer.from("RIFF0000WEBP")],
  ["avif", "image/avif", Buffer.from([0, 0, 0, 20, ...Buffer.from("ftypavif"), 0, 0, 0, 0, ...Buffer.from("avif")])]
] as const;

describe("image assets", () => {
  let directory: string;
  let configPath: string;
  let close: (() => Promise<void>) | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "vellym-assets-"));
    configPath = path.join(directory, "vellym.config.yaml");
    await mkdir(path.join(directory, "content"));
    await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
  });
  afterEach(async () => { await close?.(); close = undefined; await rm(directory, { recursive: true, force: true }); });

  it.each(images)("saves and serves %s using a generated ULID path", async (extension, mime, body) => {
    const config = await loadConfig(configPath);
    const result = await saveAsset(config, body, mime, new Date("2026-01-02T00:00:00Z"));
    expect(result.path).toMatch(new RegExp(`^2026/01/[0-9a-hjkmnp-tv-z]{26}\\.${extension}$`));
    expect(result.url).toBe(`asset:${result.path}`);
    expect(await readAsset(config.assetsRoot, result.path)).toEqual({ body, mime });
    expect(await readFile(path.join(config.assetsRoot, result.path))).toEqual(body);
  });

  it("rejects oversized, SVG, mismatched, and disguised non-image uploads", async () => {
    const config = await loadConfig(configPath);
    await expect(saveAsset({ ...config, assetsMaxBytes: 1 }, png, "image/png")).rejects.toMatchObject({ code: "ASSET_LIMIT" });
    await expect(saveAsset(config, Buffer.from("<svg/>"), "image/svg+xml")).rejects.toMatchObject({ code: "ASSET_TYPE" });
    await expect(saveAsset(config, png, "image/jpeg")).rejects.toMatchObject({ code: "ASSET_TYPE" });
    await expect(saveAsset(config, Buffer.from("<script/>"), "image/png")).rejects.toMatchObject({ code: "ASSET_TYPE" });
  });

  it("rejects traversal, symlink escape, directories and non-images", async () => {
    const config = await loadConfig(configPath);
    await mkdir(config.assetsRoot);
    await writeFile(path.join(directory, "secret.png"), png);
    await symlink(path.join(directory, "secret.png"), path.join(config.assetsRoot, "escape.png"));
    await symlink(directory, path.join(config.assetsRoot, "outside"));
    await writeFile(path.join(config.assetsRoot, "script.png"), "<script/>");
    await writeFile(path.join(config.assetsRoot, "script.svg"), "<svg/>");
    for (const file of ["../secret.png", "/secret.png", "a/../secret.png", "a\\secret.png", "escape.png", "outside/secret.png", "script.png", "script.svg", "outside"]) {
      await expect(readAsset(config.assetsRoot, file)).rejects.toBeDefined();
    }
    await symlink(directory, path.join(config.assetsRoot, "2026"));
    await expect(saveAsset(config, png, "image/png", new Date("2026-01-02"))).rejects.toMatchObject({ code: "ASSET_PATH" });
    await expect(readFile(path.join(directory, "01"))).rejects.toBeDefined();
  });

  it("extracts image references, including reference-style images, but not code or links", () => {
    expect(extractAssetReferences('![a](asset:one.png)\n![b][pic]\n\n[pic]: asset:two.png\n\n`![code](asset:no.png)`\n[link](asset:no.png)\n```md\n![code](asset:no.png)\n```')).toEqual(["one.png", "two.png"]);
  });

  it("keeps asset images through Markdown URL sanitization, without weakening other URLs", () => {
    const html = renderToStaticMarkup(React.createElement(ReactMarkdown, { urlTransform: assetUrlTransform, children: '![a](asset:2026/01/a.png) ![b](https://example.org/b.png) ![x](javascript:alert) [x](asset:a.png)' }));
    expect(html).toContain('src="/api/v1/assets?path=2026%2F01%2Fa.png"');
    expect(html).toContain('src="https://example.org/b.png"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href="asset:');
    expect(assetUrlTransform("asset:../private.png", "src")).toBe("");
  });

  it("diagnoses missing references and translations, but warns when the whole folder is unavailable", async () => {
    const config = await loadConfig(configPath);
    await writeFile(path.join(directory, "content/page.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: page
  title: Image
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: '![x](asset:missing.png)'
  translations:
    ja:
      title: 画像
      blocks:
        - id: body
          type: rich-text
          content: '![y](asset:missing-ja.png)'
`);
    const snapshot = await loadRepository(config.contentRoot);
    expect(await diagnoseAssets(config, snapshot)).toMatchObject([{ severity: "warning", code: "ASSETS_UNAVAILABLE" }]);
    await mkdir(config.assetsRoot);
    const diagnostics = await diagnoseAssets(config, snapshot);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics).toMatchObject([{ severity: "error", code: "ASSET_NOT_FOUND" }, { severity: "error", path: "/spec/translations/ja/blocks/0/content" }]);
    await writeFile(path.join(config.assetsRoot, "missing.png"), png);
    await writeFile(path.join(config.assetsRoot, "missing-ja.png"), png);
    expect(await diagnoseAssets(config, snapshot)).toEqual([]);
  });

  it("serves images and accepts bounded raw-body uploads", async () => {
    const server = await startDevServer({ configPath, uiRoot: directory, port: 0 });
    close = server.close;
    const uploaded = await fetch(`${server.url}/api/v1/assets`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    expect(uploaded.status).toBe(201);
    const saved = (await uploaded.json()).data;
    const response = await fetch(`${server.url}/api/v1/assets?path=${encodeURIComponent(saved.path)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect((await fetch(`${server.url}/api/v1/assets?path=..%2Fsecret.png`)).status).toBe(400);

  });

  it("honors editor-policy images=false without blocking image reads", async () => {
    const config = await loadConfig(configPath);
    const saved = await saveAsset(config, png, "image/png");
    const server = await startDevServer({ configPath, uiRoot: directory, port: 0, editorPolicy: { images: false } });
    close = server.close;
    expect((await fetch(`${server.url}/api/v1/assets`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png })).status).toBe(403);
    expect((await fetch(`${server.url}/api/v1/assets?path=${encodeURIComponent(saved.path)}`)).status).toBe(200);
  });

  it("limits HTTP uploads before buffering the whole body", async () => {
    await writeFile(configPath, (await readFile(configPath, "utf8")) + "assets:\n  maxBytes: 1\n");
    const server = await startDevServer({ configPath, uiRoot: directory, port: 0 });
    close = server.close;
    const response = await fetch(`${server.url}/api/v1/assets`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    expect(response.status).toBe(413);
  });

  it("never uses attacker-supplied traversal or absolute paths as upload destinations", async () => {
    const server = await startDevServer({ configPath, uiRoot: directory, port: 0 });
    close = server.close;
    for (const target of ["../escape.png", "/escape.png"]) {
      const response = await fetch(`${server.url}/api/v1/assets?path=${encodeURIComponent(target)}`, {
        method: "POST", headers: { "Content-Type": "image/png" }, body: png
      });
      expect(response.status).toBe(201);
      const saved = (await response.json()).data.path as string;
      expect(saved).toMatch(/^\d{4}\/\d{2}\/[0-9a-hjkmnp-tv-z]{26}\.png$/);
      expect(saved).not.toBe(target);
    }
    await expect(readFile(path.join(directory, "escape.png"))).rejects.toBeDefined();
  });

  it("exposes asset diagnostics and exit codes through the built validate CLI", async () => {
    await writeFile(path.join(directory, "content/page.yaml"), `apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: page\n  title: Image\nspec:\n  blocks:\n    - id: body\n      type: rich-text\n      content: '![x](asset:missing.png)'\n`);
    const args = ["packages/vellym/dist/cli.mjs", "validate", "--config", configPath, "--json"];
    const run = promisify(execFile);
    const unavailable = JSON.parse((await run(process.execPath, args, { env: { ...process.env, VELLYM_ASSETS_DIR: "" } })).stdout);
    expect(unavailable.diagnostics).toMatchObject([{ code: "ASSETS_UNAVAILABLE", severity: "warning" }]);
    await mkdir(path.join(directory, "assets"));
    try {
      await run(process.execPath, args, { env: { ...process.env, VELLYM_ASSETS_DIR: "" } });
      throw new Error("validate must fail");
    } catch (error) {
      expect(error).toMatchObject({ code: 1 });
      expect(JSON.parse((error as { stdout: string }).stdout).diagnostics).toMatchObject([{ code: "ASSET_NOT_FOUND", severity: "error" }]);
    }
  });

  it("rejects invalid configured limits", () => {
    const base = { schemaVersion: "1.0", contentRoot: "content", outputDir: "dist", ui: { language: "en" }, plugins: [] };
    for (const maxBytes of [0, -1, 1.5, "large"]) expect(validateConfig({ ...base, assets: { maxBytes } }, "config.yaml").config).toBeUndefined();
  });
});
