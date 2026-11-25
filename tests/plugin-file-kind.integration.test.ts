import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildPluginViewFromSnapshot, loadPlugins, loadRepository, pluginKinds, startDevServer } from "@vellym-internal/runtime-node";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const source = '{"color":{"$type":"color","$value":"#fff"}}\n';
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function fixture(entry?: string) {
  const root = await mkdtemp("/tmp/opencode/vellym-file-kind-");
  roots.push(root);
  const content = path.join(root, "content");
  await mkdir(path.join(content, "nested"), { recursive: true });
  const plugin = path.join(root, "node_modules/file-kind");
  await mkdir(plugin, { recursive: true });
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({
    name: "file-kind", type: "module", main: "index.mjs", engines: { vellym: ">=0.3.0-beta" },
    vellym: { id: "file-kind", contributes: { kinds: [{ kind: "Canvas" }] } }
  }));
  await writeFile(path.join(plugin, "index.mjs"), entry ?? `
    export function activate(host) {
      host.registerKind({ kind: "Canvas" });
      host.registerFileKind({ id: "tokens", pattern: "*.tokens.json", format: "json", maxBytes: 100 });
      const validate = (files) => files.some(f => f.value?.invalid) ? [{
        file: files.find(f => f.value?.invalid).relativePath, severity: "error", code: "INVALID_TOKENS",
        message: { ja: "トークンが不正です", en: "Invalid tokens" }
      }] : [];
      host.registerFileSetValidator("tokens", validate);
      host.registerFileSetValidator("tokens", validate);
      host.registerView({ id: "canvas", opensKind: "Canvas", static: true,
        view: context => ({ type: "detail", kind: "Canvas", title: "Canvas", fields: [],
          rendererData: { files: context.files } }) });
    }`);
  await writeFile(path.join(content, "canvas.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Canvas
metadata: { name: canvas, title: Canvas }
spec: { blocks: [] }
`);
  await writeFile(path.join(content, "nested/a.tokens.json"), source);
  const config = path.join(root, "vellym.config.yaml");
  await writeFile(config, `schemaVersion: "1.0"
contentRoot: content
outputDir: output
ui: { language: en }
plugins: [file-kind]
`);
  const registry = await loadPlugins({ configDir: root, packageNames: ["file-kind"], hostVersion: "0.6.0" });
  return { root, content, config, registry };
}

function cli(command: string, config: string) {
  return spawnSync(process.execPath, [path.resolve("packages/vellym/dist/cli.mjs"), command, "--config", config, "--json"], { encoding: "utf8" });
}

it("loads registered JSON with raw-byte hashes, sorted paths, and only for its owner", async () => {
  const { root, content, registry } = await fixture();
  expect(registry.diagnostics).toEqual([]);
  await writeFile(path.join(content, "z.tokens.json"), "null");
  await writeFile(path.join(content, "ignored.json"), "{");
  await writeFile(path.join(root, "outside.tokens.json"), source);
  await symlink(path.join(root, "outside.tokens.json"), path.join(content, "link.tokens.json"));
  const options = pluginKinds(registry);
  const snapshot = await loadRepository(content, undefined, options);
  const files = snapshot.pluginFiles.get("file-kind");
  expect(files).toEqual([
    { relativePath: "nested/a.tokens.json", hash: hash(source), value: JSON.parse(source) },
    { relativePath: "z.tokens.json", hash: hash("null"), value: null }
  ]);
  expect(snapshot.diagnostics).toEqual([]);
  for (const isStatic of [false, true]) {
    const payload = buildPluginViewFromSnapshot({ registry, snapshot, name: "canvas", locale: "en", isStatic });
    expect(payload?.descriptor.rendererData).toEqual({ files });
  }
  const otherRegistry = { ...registry, plugins: [{ ...registry.plugins[0]!, id: "other" }] };
  expect(buildPluginViewFromSnapshot({ registry: otherRegistry, snapshot, name: "canvas", locale: "en", isStatic: false })?.descriptor.rendererData)
    .toEqual({ files: [] });
  expect((await loadRepository(content, snapshot)).pluginFiles.size).toBe(0);
  await writeFile(path.join(content, "nested/a.tokens.json"), '{"updated":true}');
  expect((await loadRepository(content, snapshot, options)).pluginFiles.get("file-kind")?.[0]?.hash)
    .toBe(hash('{"updated":true}'));
});

it("reports broken JSON and oversized UTF-8 files in both languages", async () => {
  const { content, registry } = await fixture();
  await writeFile(path.join(content, "bad.tokens.json"), "{");
  await writeFile(path.join(content, "large.tokens.json"), JSON.stringify("あ".repeat(40)));
  const snapshot = await loadRepository(content, undefined, pluginKinds(registry));
  expect(snapshot.pluginFiles.get("file-kind")).toHaveLength(1);
  expect(snapshot.diagnostics.map(d => [d.file, d.code])).toEqual([
    ["bad.tokens.json", "PLUGIN_FILE_JSON_INVALID"], ["large.tokens.json", "PLUGIN_FILE_TOO_LARGE"]
  ]);
  for (const diagnostic of snapshot.diagnostics) {
    expect(diagnostic.message).toMatchObject({ ja: expect.any(String), en: expect.any(String) });
  }
});

it("runs file validators in real validate and contains exceptions and duplicate diagnostics", async () => {
  const { content, config, registry } = await fixture();
  await writeFile(path.join(content, "nested/a.tokens.json"), '{"invalid":true}');
  const result = cli("validate", config);
  expect(result.status, result.stderr || result.stdout).toBe(1);
  expect(JSON.parse(result.stdout).diagnostics.filter((d: { code: string }) => d.code === "INVALID_TOKENS")).toHaveLength(1);
  registry.plugins[0]!.fileSetValidators!.get("tokens")!.push(() => { throw new Error("broken"); });
  const snapshot = await loadRepository(content, undefined, pluginKinds(registry));
  expect(snapshot.diagnostics.filter(d => d.code === "INVALID_TOKENS")).toHaveLength(1);
  expect(snapshot.diagnostics.find(d => d.code === "PLUGIN_FILE_SET_VALIDATION_FAILED")?.severity).toBe("warning");
  expect(snapshot.pluginFiles.get("file-kind")).toHaveLength(1);
});

it.each(["../*.tokens.json", "nested/*.tokens.json", "nested\\*.tokens.json"])("rejects a path pattern %s", async pattern => {
  const { registry } = await fixture(`export function activate(host) {
    host.registerFileKind({ id: "tokens", pattern: ${JSON.stringify(pattern)}, format: "json", maxBytes: 100 });
  }`);
  expect(registry.plugins).toHaveLength(0);
  expect(registry.diagnostics[0]?.code).toBe("PLUGIN_ACTIVATE_FAILED");
});

it("bakes the same records into rendererData and changes the build identity when JSON changes", async () => {
  const { config, content } = await fixture();
  async function build() {
    const result = cli("build", config);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const output = JSON.parse(result.stdout).data.outputDir;
    const manifest = JSON.parse(await readFile(path.join(output, "vellym-build.json"), "utf8"));
    const payload = JSON.parse(await readFile(path.join(output, "data", manifest.buildId, "en/views/canvas.json"), "utf8")).data;
    return { manifest, files: payload.descriptor.rendererData.files };
  }
  const first = await build();
  expect(first.files).toEqual([{ relativePath: "nested/a.tokens.json", hash: hash(source), value: JSON.parse(source) }]);
  await writeFile(path.join(content, "nested/a.tokens.json"), '{"next":1}');
  const next = await build();
  expect(next.files[0].value).toEqual({ next: 1 });
  expect(next.manifest.buildId).not.toBe(first.manifest.buildId);
  expect(next.manifest.contentHash).not.toBe(first.manifest.contentHash);
}, 30_000);

it("refreshes the dev view after an external JSON edit", async () => {
  const { root, config, content } = await fixture();
  const server = await startDevServer({ configPath: config, uiRoot: root, port: 0, hostVersion: "0.6.0" });
  try {
    const view = async () => (await (await fetch(`${server.url}/api/v1/plugins/views/canvas`)).json()).data;
    expect((await view()).descriptor.rendererData.files[0].hash).toBe(hash(source));
    const events = await fetch(`${server.url}/api/v1/events`);
    const reader = events.body!.getReader();
    try {
      let text = "";
      while (!text.includes('"watcher":"connected"')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Events closed before watcher ready");
        text += new TextDecoder().decode(chunk.value);
      }
    } finally { await reader.cancel(); }
    // The watcher is asynchronous; assertion retries wait for its observable effect.
    await writeFile(path.join(content, "nested/a.tokens.json"), '{"external":true}');
    await expect.poll(async () => (await view()).descriptor.rendererData.files[0].value, { timeout: 10_000 })
      .toEqual({ external: true });
  } finally { await server.close(); }
}, 15_000);
