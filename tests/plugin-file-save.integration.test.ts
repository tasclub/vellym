import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { startDevServer } from "@vellym-internal/runtime-node";

it("creates and updates only registered JSON files with hash and path checks", async () => {
  const root = await mkdtemp("/tmp/opencode/vellym-file-save-");
  const content = path.join(root, "content");
  await mkdir(content);
  const plugin = path.join(root, "node_modules/file-kind");
  await mkdir(plugin, { recursive: true });
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({
    name: "file-kind", type: "module", main: "index.mjs", engines: { vellym: ">=0.3.0-beta" },
    vellym: { id: "file-kind", contributes: { kinds: [{ kind: "Canvas" }] } }
  }));
  await writeFile(path.join(plugin, "index.mjs"), `export function activate(host) {
    host.registerKind({kind: "Canvas"});
    host.registerFileKind({id: "tokens", pattern: "*.tokens.json", format: "json", maxBytes: 1024});
  }`);
  const config = path.join(root, "vellym.config.yaml");
  await writeFile(config, `schemaVersion: "1.0"\ncontentRoot: content\noutputDir: output\nui: { language: en }\nplugins: [file-kind]\n`);
  const server = await startDevServer({ configPath: config, uiRoot: root, port: 0, hostVersion: "0.6.0" });
  try {
    const save = (relativePath: string, value: unknown, baseHash: string | null, pluginId = "file-kind") =>
      fetch(`${server.url}/api/v1/plugins/files`, { method: "PUT", headers: { "content-type": "application/json", origin: server.url }, body: JSON.stringify({ pluginId, relativePath, value, baseHash }) });
    const first = await save("a.tokens.json", { z: 1, a: 2 }, null);
    expect(first.status).toBe(200);
    const text = '{\n  "z": 1,\n  "a": 2\n}\n';
    expect(await readFile(path.join(content, "a.tokens.json"), "utf8")).toBe(text);
    const hash = (await first.json()).data.hash;
    expect(hash).toBe(createHash("sha256").update(text).digest("hex"));
    expect((await save("a.tokens.json", {}, null)).status).toBe(409);
    expect((await save("a.tokens.json", {}, "0".repeat(64))).status).toBe(409);
    const updated = await save("a.tokens.json", { updated: true }, hash);
    expect(updated.status).toBe(200);
    expect((await updated.json()).data.hash).toBe(createHash("sha256").update('{\n  "updated": true\n}\n').digest("hex"));
    expect((await save("other.json", {}, null)).status).toBe(403);
    expect((await save("b.tokens.json", {}, null, "other")).status).toBe(403);
    expect((await save("../outside.tokens.json", {}, null)).status).toBe(422);
    await symlink(root, path.join(content, "outside"));
    expect((await save("outside/escape.tokens.json", {}, null)).status).toBe(422);
    expect((await fetch(`${server.url}/api/v1/plugins/files`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
