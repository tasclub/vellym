// DNS rebinding: loopback Host allowlist; cross-site writes: Origin validation;
// CORS: no access grants; response hardening: nosniff, frame denial and referrer policy.
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDevServer } from "@vellym-internal/runtime-node";

// Literal route prefixes are included too: server.ts uses them for rejecting unknown setup routes.
const readOnly = ["/api/v1/bootstrap", "/api/v1/setup/catalog", "/api/v1/setup/", "/api/v1/templates/", "/api/v1/git/status", "/api/v1/git/change-diff", "/api/v1/repository", "/api/v1/structure/archived", "/api/v1/search", "/api/v1/folders/edit", "/api/v1/events", "/api/v1/assets", "/api/v1/pages/example", "/api/v1/pages/example/edit", "/api/v1/plugins/views/example", ...["history", "diff", "content", "recent", "mentions"].map(x => `/api/v1/git/${x}`)];
const writes = [
  ...["/api/v1/fonts/google", "/api/v1/assets", "/api/v1/setup/plan", "/api/v1/setup/apply", "/api/v1/templates/plan", "/api/v1/templates/apply", "/api/v1/git/commit", "/api/v1/git/push", "/api/v1/config/content-root/plan", "/api/v1/config/content-root/apply", "/api/v1/config/ui-language", "/api/v1/pages/slug-migration/plan", "/api/v1/pages/slug-migration/apply", "/api/v1/structure/plan", "/api/v1/structure/apply", "/api/v1/structure/undo", "/api/v1/plugins/commands/example", "/api/v1/plugins/resources"].map(p => ["POST", p] as const),
  ["PATCH", "/api/v1/folders"], ["PATCH", "/api/v1/pages/example"],
  ["PUT", "/api/v1/plugins/files"], ["DELETE", "/api/v1/plugins/resources/example"]
] as const;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

describe("HTTP security boundary", () => {
  let dir: string, root: string, url: string, close: () => Promise<void>;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vellym-http-security-")); root = path.join(dir, "content");
    await mkdir(root); await mkdir(path.join(dir, "assets"));
    await writeFile(path.join(root, "page.yaml"), "apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: example\n  title: Example\nspec:\n  blocks: []\n");
    await writeFile(path.join(dir, "assets", "image.png"), png);
    await writeFile(path.join(dir, "index.html"), "<h1>UI</h1>");
    const configPath = path.join(dir, "vellym.config.yaml");
    await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
    const server = await startDevServer({ configPath, uiRoot: dir, host: "127.0.0.1", port: 0 }); url = server.url; close = server.close;
  });
  afterAll(async () => { await close?.(); if (dir) await rm(dir, { recursive: true, force: true }); });
  async function snapshot(folder = root, prefix = ""): Promise<string[]> {
    const entries = await readdir(folder, { withFileTypes: true });
    const result: string[] = [];
    for (const e of entries) {
      const name = path.join(prefix, e.name), file = path.join(folder, e.name);
      if (e.isDirectory()) result.push(...await snapshot(file, name));
      else result.push(`${name}:${createHash("sha256").update(await readFile(file)).digest("hex")}`);
    }
    return result.sort();
  }
  function hostGet(route: string, host: string): Promise<{status: number, body: string}> {
    const target = new URL(route, url);
    return new Promise((resolve, reject) => {
      const r = request(target, { headers: { Host: host } }, res => {
        let body = ""; res.setEncoding("utf8"); res.on("data", chunk => body += chunk);
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }); r.on("error", reject); r.end();
    });
  }
  it("classifies every literal API route in server.ts", async () => {
    const source = await readFile("packages/runtime-node/src/server.ts", "utf8");
    const routes = [...source.matchAll(/"(\/api\/v1\/[^\"]+)"/g)].map(m => m[1]!);
    expect([...new Set(routes)].filter(route => !readOnly.includes(route) && !writes.some(([, p]) => p === route))).toEqual([]);
  });
  it("rejects rebound hosts and permits loopback hosts", async () => {
    for (const route of ["/", "/api/v1/bootstrap"]) {
      const denied = await hostGet(route, "attacker.example"); expect(denied.status).toBe(403);
      expect(JSON.parse(denied.body).diagnostics[0].code).toBe("HOST");
      for (const host of ["localhost", `127.0.0.1:${new URL(url).port}`]) expect((await hostGet(route, host)).status).toBe(200);
    }
  });
  it.each(writes)("rejects cross-site %s %s without changing content", async (method, route) => {
    const before = await snapshot();
    const response = await fetch(url + route, { method, headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(403); expect((await response.json()).diagnostics[0].code).toBe("ORIGIN");
    expect(response.headers.has("access-control-allow-origin")).toBe(false); expect(await snapshot()).toEqual(before);
  });
  it("allows originless non-browser clients, except plugin resource deletion", async () => {
    // Browsers send Origin on cross-origin non-GET requests; CLI clients may omit it.
    const upload = await fetch(url + "/api/v1/assets", { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    expect(upload.status).toBe(201);
    const deletion = await fetch(url + "/api/v1/plugins/resources/example", { method: "DELETE" });
    expect(deletion.status).toBe(403); expect((await deletion.json()).diagnostics[0].code).toBe("ORIGIN");
  });
  it("never grants CORS and hardens HTML, JSON, image and error responses", async () => {
    const responses = await Promise.all([
      fetch(url + "/"), fetch(url + "/api/v1/bootstrap"), fetch(url + "/api/v1/assets?path=image.png"),
      fetch(url + "/missing-file.js"), fetch(url + "/api/v1/assets", { method: "POST", headers: { Origin: "https://evil.example" } }),
      fetch(url + "/api/v1/assets", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } })
    ]);
    expect(responses.map(r => r.status)).toEqual([200, 200, 200, 404, 403, 403]);
    for (const r of responses) {
      expect(r.headers.has("access-control-allow-origin")).toBe(false);
      expect(r.headers.has("access-control-allow-methods")).toBe(false);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
      expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });
});
