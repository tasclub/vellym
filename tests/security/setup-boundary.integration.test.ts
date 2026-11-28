import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDevServer } from "@vellym-internal/runtime-node";
import { fixture } from "./helpers.js";

// validate already covers external links: tests/file-links.integration.test.ts,
// "checks base and translated links without accessing external symlinks".
describe("setup and write boundaries", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { await f?.close(); });
  async function restart() {
    await f.server.close();
    f.server = await startDevServer({ configPath: path.join(f.project, "vellym.config.yaml"), uiRoot: f.project, port: 0, hostVersion: "0.6.0" });
    f.close = async () => { await f.server.close(); await rm(f.dir, { recursive: true, force: true }); };
  }
  const page = (name: string) => `apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata: { name: ${name}, title: ${name} }\nspec: { blocks: [] }\n`;
  async function projectSnapshot(excluded: string) {
    async function walk(dir: string, prefix = ""): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        const relative = path.join(prefix, entry.name);
        if (relative === excluded || relative === ".git") continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(`dir:${relative}`, ...await walk(file, relative));
        else if (entry.isFile()) results.push(`${relative}:${createHash("sha256").update(await readFile(file)).digest("hex")}`);
      }
      return results.sort();
    }
    return walk(f.project);
  }
  it.each(["", 'contentRoot: "."\n'])("excludes output and assets when contentRoot is %s", async contentRoot => {
    await mkdir(path.join(f.project, "output"), { recursive: true });
    await writeFile(path.join(f.project, "output/hidden-output.yaml"), page("hidden-output"));
    await writeFile(path.join(f.project, "assets/hidden-assets.yaml"), page("hidden-assets"));
    await writeFile(path.join(f.project, "vellym.config.yaml"), `schemaVersion: "1.0"\n${contentRoot}outputDir: output\nui: { language: en }\nplugins: []\n`);
    await restart();
    {
      const body = await (await fetch(`${f.server.url}/api/v1/repository`)).text();
      expect(body).toContain("example");
      expect(body).not.toContain("hidden-output");
      expect(body).not.toContain("hidden-assets");
    }
  });
  it("applies templates and saves plugin JSON only within content root", async () => {
    if (process.platform !== "win32") await unlink(path.join(f.project, "content/link.yaml"));
    const before = await f.outsideSnapshot();
    const projectBefore = await projectSnapshot("content");
    const post = (route: string, body: unknown, method = "POST") => fetch(`${f.server.url}/api/v1/${route}`, { method, headers: { "content-type": "application/json", origin: f.server.url }, body: JSON.stringify(body) });
    const planResponse = await post("templates/plan", { kind: "template", id: "decision", folder: "section", language: "en" });
    expect(planResponse.status).toBe(200);
    const plan = (await planResponse.json()).data;
    expect((await post("templates/apply", plan)).status).toBe(200);
    expect((await post("plugins/files", { pluginId: "file-kind", relativePath: "new.tokens.json", value: { test: true }, baseHash: null }, "PUT")).status).toBe(200);
    expect(await readFile(path.join(f.project, "content/new.tokens.json"), "utf8")).toContain('"test"');
    expect(await f.outsideSnapshot()).toEqual(before);
    expect(await projectSnapshot("content")).toEqual(projectBefore);
  });
  it("saves fonts under assets/fonts and never connects to another host", async () => {
    let hostile = false, hits = 0, origin = "", other = "";
    const forbidden = createServer((_req, res) => { hits++; res.end("bad"); });
    await new Promise<void>(resolve => forbidden.listen(0, "127.0.0.2", resolve));
    const address = forbidden.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    other = `http://127.0.0.2:${address.port}`;
    const upstream = createServer((req, res) => {
      if (req.url?.startsWith("/css2")) res.end(`@font-face { font-weight: 400; src: url(${hostile ? other + "/x.woff2" : origin + "/font"}) format('woff2'); unicode-range: U+0000-00FF; }`);
      else { res.setHeader("Content-Length", 8); res.end(req.method === "HEAD" ? undefined : "wOF2test"); }
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("missing address");
    origin = `http://127.0.0.1:${upstreamAddress.port}`;
    const oldCss = process.env.VELLYM_GOOGLE_FONTS_CSS_URL, oldFile = process.env.VELLYM_GOOGLE_FONTS_FILE_URL;
    process.env.VELLYM_GOOGLE_FONTS_CSS_URL = `${origin}/css2`;
    process.env.VELLYM_GOOGLE_FONTS_FILE_URL = origin;
    try {
      await restart();
      const before = await f.outsideSnapshot();
      const projectBefore = await projectSnapshot("assets/fonts");
      const post = () => fetch(`${f.server.url}/api/v1/fonts/google`, { method: "POST", headers: { "content-type": "application/json", origin: f.server.url }, body: JSON.stringify({ family: "ABeeZee", weights: [400], dryRun: false }) });
      const response = await post();
      const responseBody = await response.text();
      expect(response.status, responseBody).toBe(200);
      const result = JSON.parse(responseBody).data;
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toMatch(/^fonts\//);
      expect(await readFile(path.join(f.project, "assets", result.files[0].path), "utf8")).toBe("wOF2test");
      expect(await readFile(path.join(f.project, "assets/fonts/ABeeZee/LICENSE.txt"), "utf8")).toContain("ABeeZee");
      hostile = true;
      expect((await post()).status).toBe(400);
      expect(hits).toBe(0);
      expect(await f.outsideSnapshot()).toEqual(before);
      expect(await projectSnapshot("assets/fonts")).toEqual(projectBefore);
    } finally {
      if (oldCss === undefined) delete process.env.VELLYM_GOOGLE_FONTS_CSS_URL; else process.env.VELLYM_GOOGLE_FONTS_CSS_URL = oldCss;
      if (oldFile === undefined) delete process.env.VELLYM_GOOGLE_FONTS_FILE_URL; else process.env.VELLYM_GOOGLE_FONTS_FILE_URL = oldFile;
      await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => forbidden.close(error => error ? reject(error) : resolve()));
    }
  });
});
