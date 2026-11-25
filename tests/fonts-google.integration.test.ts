import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDevServer } from "@vellym-internal/runtime-node";

describe("Google Fonts download", () => {
  let directory: string;
  let upstream: Server;
  let close: () => Promise<void>;
  let api: string;
  let origin: string;
  let requests: string[];
  let hostile: boolean;
  const font = Buffer.from("wOF2test");

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "vellym-google-fonts-"));
    await mkdir(path.join(directory, "content"));
    const configPath = path.join(directory, "vellym.config.yaml");
    await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
    requests = [];
    hostile = false;
    upstream = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      if (req.url?.startsWith("/css2")) {
        res.end(`@font-face { font-weight: 400; src: url(${hostile ? "http://example.com/font" : `${origin}/font`}) format('woff2'); unicode-range: U+0000-00FF; }`);
      } else {
        res.setHeader("Content-Length", font.length);
        res.end(req.method === "HEAD" ? undefined : font);
      }
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("No address");
    origin = `http://127.0.0.1:${address.port}`;
    process.env.VELLYM_GOOGLE_FONTS_CSS_URL = `${origin}/css2`;
    process.env.VELLYM_GOOGLE_FONTS_FILE_URL = origin;
    const server = await startDevServer({ configPath, uiRoot: directory, port: 0 });
    close = server.close;
    api = `${server.url}/api/v1/fonts/google`;
  });
  afterEach(async () => {
    await close();
    await new Promise<void>((resolve, reject) => upstream.close(err => err ? reject(err) : resolve()));
    delete process.env.VELLYM_GOOGLE_FONTS_CSS_URL;
    delete process.env.VELLYM_GOOGLE_FONTS_FILE_URL;
    await rm(directory, { recursive: true, force: true });
  });
  const post = (url: string, family: string, dryRun: boolean) => fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ family, weights: [400], dryRun })
  });
  it("measures with HEAD only and saves WOFF2 and the bundled license", async () => {
    const preview = await post(api, "ABeeZee", true);
    expect(preview.status).toBe(200);
    expect((await preview.json() as any).data.totalBytes).toBe(font.length);
    expect(requests.some(r => r === "GET /font")).toBe(false);
    const response = await post(api, "ABeeZee", false);
    expect(response.status).toBe(200);
    const result = (await response.json() as any).data;
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ weight: 400, unicodeRange: "U+0000-00FF" });
    const assets = path.join(directory, "assets");
    expect(await readFile(path.join(assets, result.files[0].path))).toEqual(font);
    expect(await readFile(path.join(assets, "fonts/ABeeZee/LICENSE.txt"), "utf8")).toContain("Copyright 2011 The ABeeZee Project Authors");
  });
  it("rejects unapproved URLs before making a font request", async () => {
    hostile = true;
    expect((await post(api, "ABeeZee", false)).status).toBe(400);
    expect(requests).toHaveLength(1);
  });
  it.each(["Aclonica", "Ubuntu"])("saves the license for %s", async family => {
    expect((await post(api, family, false)).status).toBe(200);
    const license = await readFile(path.join(directory, "assets", "fonts", family, "LICENSE.txt"), "utf8");
    expect(license).toContain(family === "Ubuntu" ? "UBUNTU FONT LICENCE" : "Apache License");
  });
});
