import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, readAsset, saveFontAsset, startDevServer } from "@vellym-internal/runtime-node";

const fonts = [
  ["woff2", "font/woff2", Buffer.from("wOF2\0\0\0\0")],
  ["woff", "font/woff", Buffer.from("wOFF\0\0\0\0")],
  ["ttf", "font/ttf", Buffer.from([0, 1, 0, 0, 0, 0, 0, 0])],
  ["otf", "font/otf", Buffer.from("OTTO\0\0\0\0")]
] as const;

describe("font assets", () => {
  let directory: string;
  let configPath: string;
  let close: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "vellym-font-assets-"));
    configPath = path.join(directory, "vellym.config.yaml");
    await mkdir(path.join(directory, "content"));
    await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it.each(fonts)("saves and reads %s fonts inside the family directory", async (_extension, mime, body) => {
    const config = await loadConfig(configPath);
    const saved = await saveFontAsset(config, body, mime, "Noto Sans JP", new Date("2026-01-02T00:00:00Z"));

    expect(saved.path).toMatch(/^fonts\/Noto Sans JP\/[0-9a-hjkmnp-tv-z]{26}\.(woff2|woff|ttf|otf)$/);
    expect(saved.url).toBe(`asset:${saved.path}`);
    expect(await readAsset(config.assetsRoot, saved.path)).toEqual({ body, mime });
    expect(await readFile(path.join(config.assetsRoot, saved.path))).toEqual(body);
  });

  it("stores plain-text licenses as LICENSE.txt in the font family directory", async () => {
    const config = await loadConfig(configPath);
    const license = Buffer.from("SIL OPEN FONT LICENSE Version 1.1\n");
    const saved = await saveFontAsset(config, license, "text/plain", "Noto Sans JP");

    expect(saved.path).toBe("fonts/Noto Sans JP/LICENSE.txt");
    expect(await readAsset(config.assetsRoot, saved.path)).toEqual({
      body: license,
      mime: "text/plain; charset=utf-8"
    });
    expect(await saveFontAsset(config, license, "text/plain", "Noto Sans JP")).toEqual(saved);
    await expect(saveFontAsset(config, Buffer.from("different license"), "text/plain", "Noto Sans JP"))
      .rejects.toMatchObject({ code: "ASSET_TYPE", status: 409 });
  });

  it("rejects mismatched font signatures, invalid licenses, unsupported types and oversized assets", async () => {
    const config = await loadConfig(configPath);
    for (const mime of ["font/woff2", "font/woff", "font/ttf", "font/otf"]) {
      await expect(saveFontAsset(config, Buffer.from("<not a font>"), mime, "Example"))
        .rejects.toMatchObject({ code: "ASSET_TYPE", status: 415 });
    }
    await expect(saveFontAsset(config, fonts[0]![2], "font/woff", "Example"))
      .rejects.toMatchObject({ code: "ASSET_TYPE", status: 415 });
    await expect(saveFontAsset(config, Buffer.from([0xff]), "text/plain", "Example"))
      .rejects.toMatchObject({ code: "ASSET_TYPE", status: 415 });
    await expect(saveFontAsset(config, fonts[0]![2], "application/octet-stream", "Example"))
      .rejects.toMatchObject({ code: "ASSET_TYPE", status: 415 });
    await expect(saveFontAsset({ ...config, assetsMaxBytes: 1 }, fonts[0]![2], "font/woff2", "Example"))
      .rejects.toMatchObject({ code: "ASSET_LIMIT", status: 413 });
  });

  it("requires a single safe family name and rejects font files outside fonts/<family>", async () => {
    const config = await loadConfig(configPath);
    for (const family of [undefined, "", "../outside", "Example/../../outside", "Example\\outside", ".."]) {
      await expect(saveFontAsset(config, fonts[0]![2], "font/woff2", family))
        .rejects.toMatchObject({ code: "ASSET_PATH", status: 400 });
    }

    await mkdir(path.join(config.assetsRoot, "outside"), { recursive: true });
    await writeFile(path.join(config.assetsRoot, "outside", "font.woff2"), fonts[0]![2]);
    await expect(readAsset(config.assetsRoot, "outside/font.woff2"))
      .rejects.toMatchObject({ code: "ASSET_TYPE", status: 415 });
  });

  it("uploads and serves fonts and licenses with their correct content types", async () => {
    const server = await startDevServer({ configPath, uiRoot: directory, port: 0 });
    close = server.close;

    const fontBody = fonts[0]![2];
    const uploadedFont = await fetch(`${server.url}/api/v1/assets?family=${encodeURIComponent("Noto Sans JP")}`, {
      method: "POST",
      headers: { "Content-Type": "font/woff2" },
      body: fontBody
    });
    expect(uploadedFont.status).toBe(201);
    const fontPath = ((await uploadedFont.json()) as { data: { path: string } }).data.path;
    expect(fontPath).toMatch(/^fonts\/Noto Sans JP\/.+\.woff2$/);

    const servedFont = await fetch(`${server.url}/api/v1/assets?path=${encodeURIComponent(fontPath)}`);
    expect(servedFont.status).toBe(200);
    expect(servedFont.headers.get("content-type")).toBe("font/woff2");
    expect(servedFont.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await servedFont.arrayBuffer())).toEqual(fontBody);

    const license = Buffer.from("Open Font License\n");
    const uploadedLicense = await fetch(`${server.url}/api/v1/assets?family=${encodeURIComponent("Noto Sans JP")}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: license
    });
    expect(uploadedLicense.status).toBe(201);
    const licensePath = ((await uploadedLicense.json()) as { data: { path: string } }).data.path;
    expect(licensePath).toBe("fonts/Noto Sans JP/LICENSE.txt");

    const servedLicense = await fetch(`${server.url}/api/v1/assets?path=${encodeURIComponent(licensePath)}`);
    expect(servedLicense.status).toBe(200);
    expect(servedLicense.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(Buffer.from(await servedLicense.arrayBuffer())).toEqual(license);
  });

  it("rejects missing or unsafe families and enforces assets.maxBytes before buffering", async () => {
    await writeFile(configPath, (await readFile(configPath, "utf8")) + "assets:\n  maxBytes: 4\n");
    const server = await startDevServer({ configPath, uiRoot: directory, port: 0 });
    close = server.close;

    const fontBody = Buffer.from("wOF2");
    expect((await fetch(`${server.url}/api/v1/assets`, {
      method: "POST", headers: { "Content-Type": "font/woff2" }, body: fontBody
    })).status).toBe(400);

    expect((await fetch(`${server.url}/api/v1/assets?family=${encodeURIComponent("../outside")}`, {
      method: "POST", headers: { "Content-Type": "font/woff2" }, body: fontBody
    })).status).toBe(400);

    expect((await fetch(`${server.url}/api/v1/assets?family=Example`, {
      method: "POST", headers: { "Content-Type": "font/woff2" }, body: Buffer.from("wOF2!")
    })).status).toBe(413);
  });
});
