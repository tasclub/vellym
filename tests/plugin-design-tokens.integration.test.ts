import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildPluginViewFromSnapshot, loadPlugins, loadRepository, pluginKinds } from "@vellym-internal/runtime-node";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const color = { colorSpace: "srgb", components: [1, 0, 1], hex: "#ff00ff" };
const token = (type: string, value: unknown) => ({ $type: type, $value: value });
const resolver = {
  version: "2025.10",
  sets: { foundation: { sources: [{ $ref: "base.tokens.json" }, { gap: token("dimension", { value: 16, unit: "px" }) }] } },
  modifiers: { theme: { contexts: {
    light: [{ accent: token("color", color) }],
    dark: [{ accent: token("color", { ...color, components: [0, 0, 0] }) }]
  }, default: "light" } },
  resolutionOrder: [{ $ref: "#/sets/foundation" }, { $ref: "#/modifiers/theme" }]
};

async function fixture() {
  const root = await mkdtemp("/tmp/opencode/design-tokens-");
  roots.push(root);
  const content = path.join(root, "content");
  await mkdir(path.join(content, "design"), { recursive: true });
  await mkdir(path.join(root, "node_modules/@vellym"), { recursive: true });
  await symlink(path.resolve("packages/plugin-design"), path.join(root, "node_modules/@vellym/design"));
  await writeFile(path.join(root, "vellym.config.yaml"), `schemaVersion: "1.0"
contentRoot: content
outputDir: output
ui: { language: en }
plugins: ["@vellym/design"]
`);
  await writeFile(path.join(content, "canvas.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: DesignCanvas
metadata: { name: canvas, title: Canvas }
spec: { formatVersion: 1 }
`);
  const write = async (name: string, value: unknown) =>
    writeFile(path.join(content, name), JSON.stringify(value));
  await write("design/base.tokens.json", {
    // This self-alias is replaced by the later source, so it must never resolve.
    gap: token("dimension", "{gap}"), button: { $value: "{accent}" }
  });
  await write("design/main.resolver.json", resolver);
  const registry = await loadPlugins({ configDir: root, packageNames: ["@vellym/design"], hostVersion: "0.6.0" });
  expect(registry.diagnostics).toEqual([]);
  const cli = (language = "en") => spawnSync(process.execPath, [path.resolve("packages/vellym/dist/cli.mjs"),
    "validate", "--config", path.join(root, "vellym.config.yaml"), "--json", "--language", language], { encoding: "utf8" });
  return { root, content, registry, write, cli };
}

it("real CLI validates Resolver→tokens and aliases after ordered sources and all selected modes", async () => {
  const { content, registry, cli, write } = await fixture();
  const result = cli();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(JSON.parse(result.stdout).diagnostics).toEqual([]);
  const snapshot = await loadRepository(content, undefined, pluginKinds(registry));
  const view = buildPluginViewFromSnapshot({ registry, snapshot, name: "canvas", locale: "en", isStatic: false });
  expect(view?.descriptor.rendererData?.tokenFiles).toEqual(snapshot.pluginFiles.get("design"));
  expect(snapshot.pluginFiles.get("design")?.map(f => f.relativePath))
    .toEqual(["design/base.tokens.json", "design/main.resolver.json"]);
  // Only the non-default mode is broken: validate must not check light alone.
  await write("design/main.resolver.json", {
    ...resolver, modifiers: { theme: { ...resolver.modifiers.theme,
      contexts: { light: resolver.modifiers.theme.contexts.light, dark: [{ accent: { $value: "{missing}" } }] } } }
  });
  const broken = cli();
  expect(broken.status, broken.stderr || broken.stdout).toBe(1);
  expect(JSON.parse(broken.stdout).diagnostics.some((d: { code: string }) => d.code === "DESIGN_TOKEN_REFERENCE_MISSING")).toBe(true);
});

it("real CLI diagnoses cycles, missing aliases and resolver sources in Japanese and English without duplicates", async () => {
  const { cli, write } = await fixture();
  await write("design/base.tokens.json", {
    a: { $value: "{b}" }, b: { $value: "{a}" }, c: { $value: "{missing}" }
  });
  const result = cli();
  expect(result.status, result.stderr || result.stdout).toBe(1);
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  expect(diagnostics.map((d: { file: string; path: string; code: string }) => [d.file, d.path, d.code])).toEqual([
    ["design/base.tokens.json", "a", "DESIGN_TOKEN_CYCLE"],
    ["design/base.tokens.json", "b", "DESIGN_TOKEN_CYCLE"],
    ["design/base.tokens.json", "c", "DESIGN_TOKEN_REFERENCE_MISSING"]
  ]);
  expect(diagnostics.map((d: { message: string }) => d.message))
    .toEqual(["Token references form a cycle.", "Token references form a cycle.", "Referenced token does not exist."]);
  expect(JSON.parse(cli("ja").stdout).diagnostics.map((d: { message: string }) => d.message))
    .toEqual(["トークンの参照が循環しています", "トークンの参照が循環しています", "参照先のトークンがありません"]);
  await write("design/main.resolver.json", { version: "2025.10",
    resolutionOrder: [{ type: "set", name: "base", sources: [{ $ref: "not-registered.tokens.json" }] }] });
  const missing = cli();
  expect(missing.status).toBe(1);
  expect(JSON.parse(missing.stdout).diagnostics.find((d: { code: string }) => d.code === "DESIGN_RESOLVER_INVALID")?.message)
    .toBe("Invalid resolver definition, reference, or mode selection.");
  expect(JSON.parse(cli("ja").stdout).diagnostics.find((d: { code: string }) => d.code === "DESIGN_RESOLVER_INVALID")?.message)
    .toBe("Resolverの定義・参照またはモードの選択が不正です");
});

it("does not suppress missing aliases in files unrelated to a resolver and validates plain token files", async () => {
  const { cli, write } = await fixture();
  await write("unrelated.tokens.json", { a: { $value: "{missing}" } });
  expect(JSON.parse(cli().stdout).diagnostics).toContainEqual(expect.objectContaining({
    file: "unrelated.tokens.json", code: "DESIGN_TOKEN_REFERENCE_MISSING"
  }));
  await write("unrelated.tokens.json", { a: token("dimension", { value: 10, unit: "ms" }) });
  expect(JSON.parse(cli().stdout).diagnostics).toContainEqual(expect.objectContaining({
    file: "unrelated.tokens.json", code: "DESIGN_TOKEN_INVALID"
  }));
});

it("passes only the owner's file kinds, with stable sorted arrays, to cross-kind validators", async () => {
  const { root, content, registry } = await fixture();
  const other = path.join(root, "node_modules/other");
  await mkdir(other);
  await writeFile(path.join(other, "package.json"), JSON.stringify({
    name: "other", type: "module", main: "index.mjs", engines: { vellym: ">=0.5.0-beta" },
    vellym: { id: "other" }
  }));
  await writeFile(path.join(other, "index.mjs"), `export function activate(host) {
    host.registerFileKind({ id: "private", pattern: "*.private.json", format: "json", maxBytes: 100 });
    host.registerFileSetValidator("private", (files, context) => {
      if (Object.keys(context.pluginFiles).join(",") !== "private") throw Error("Foreign files");
      return [];
    });
  }`);
  await writeFile(path.join(content, "secret.private.json"), "{}");
  const others = await loadPlugins({ configDir: root, packageNames: ["other"], hostVersion: "0.6.0" });
  expect(others.diagnostics).toEqual([]);
  registry.plugins.push(...others.plugins);
  const capture: unknown[] = [];
  registry.plugins.find(p => p.id === "design")!.fileSetValidators!.get("resolver")!.push((files, context) => {
    capture.push({ files: files.map(f => f.relativePath),
      kinds: Object.keys(context.pluginFiles), tokens: context.pluginFiles.tokens?.map(f => f.relativePath) });
    return [];
  });
  const snapshot = await loadRepository(content, undefined, pluginKinds(registry));
  expect(snapshot.diagnostics).toEqual([]);
  expect(capture).toEqual([{ files: ["design/main.resolver.json"], kinds: ["tokens", "resolver"], tokens: ["design/base.tokens.json"] }]);
});
