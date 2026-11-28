import path from "node:path";
import { chmod, realpath, rm, writeFile } from "node:fs/promises";
import { startDevServer } from "@vellym-internal/runtime-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

describe("error information disclosure", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  let paths: string[];
  beforeEach(async () => { f = await fixture(); paths = [f.dir, await realpath(f.dir)]; });
  afterEach(async () => { await f?.close(); });
  function safe(text: string) { for (const p of paths) expect(text).not.toContain(p); }
  async function restart() {
    await f.server.close();
    f.server = await startDevServer({ configPath: path.join(f.project, "vellym.config.yaml"), uiRoot: f.project, port: 0, hostVersion: "0.6.0" });
    f.close = async () => { await f.server.close(); await rm(f.dir, { recursive: true, force: true }); };
  }
  async function diagnostics() {
    const r = await fetch(`${f.server.url}/api/v1/repository`);
    const body = await r.text();
    safe(body);
    return body;
  }
  it.each([
    ["/api/v1/assets?path=../outside.png", "GET", undefined],
    ["/api/v1/git/history?path=../outside.yaml", "GET", undefined],
    ["/api/v1/plugins/files", "PUT", JSON.stringify({ pluginId: "file-kind", relativePath: "../outside.tokens.json", value: {}, baseHash: null })]
  ])("does not disclose paths for %s", async (route, method, body) => {
    const r = await fetch(f.server.url + route!, { method, headers: { "content-type": "application/json", origin: f.server.url }, body });
    expect(r.status).toBeGreaterThanOrEqual(400);
    safe(await r.text());
    await diagnostics();
  });
  // root bypasses mode 000, so it cannot reproduce a permission error.
  // READ_ERROR currently embeds the OS error's absolute filename.
  it.skipIf(process.getuid?.() === 0).fails("does not disclose paths for unreadable pages", async () => {
    const file = path.join(f.project, "content/unreadable.yaml");
    await writeFile(file, "apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata: { name: unreadable, title: Unreadable }\nspec: { blocks: [] }\n");
    await chmod(file, 0);
    try {
      await restart();
      const body = await (await fetch(`${f.server.url}/api/v1/repository`)).text();
      expect(body).toContain("unreadable");
      const page = await (await fetch(`${f.server.url}/api/v1/pages/example`)).text();
      safe(page);
      safe(body);
    } finally { await chmod(file, 0o600); }
  });
  it.each([
    ['{"baseHash":', 400],
    [JSON.stringify({ baseHash: "x", blocks: [{ id: "body", type: "rich-text", content: 1 }] }), 400]
  ])("does not disclose paths for invalid PATCH", async (body, status) => {
    const r = await fetch(`${f.server.url}/api/v1/pages/example`, { method: "PATCH", headers: { "content-type": "application/json", origin: f.server.url }, body });
    expect(r.status).toBe(status);
    const text = await r.text();
    if (body === '{"baseHash":') expect(text).toContain("INVALID_JSON");
    safe(text);
    await diagnostics();
  });
  it("reports malformed YAML without exposing absolute paths", async () => {
    await writeFile(path.join(f.project, "content/broken.yaml"), "apiVersion: [");
    await restart();
    const repository = await diagnostics();
    expect(repository).toContain("broken.yaml");
    const page = await (await fetch(`${f.server.url}/api/v1/pages/example`)).text();
    expect(page).toContain("broken.yaml");
    safe(page);
  });
});
