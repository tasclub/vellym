import { mkdtemp, readFile, readdir, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { planInit } from "../packages/runtime-node/src/setup-init.js";
import { loadCatalog } from "../packages/runtime-node/src/catalog/load.js";

const cli = path.resolve("packages/vellym/dist/cli.mjs");
const version = JSON.parse(await readFile("packages/vellym/package.json", "utf8")).version as string;
const temporary = () => mkdtemp(path.join(tmpdir(), "vellym-init-cli-"));
function run(root: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [cli, "init", ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, LC_ALL: "", LC_MESSAGES: "", LANG: "en_US.UTF-8", ...env }
  });
}

describe("init CLI arguments", () => {
  it("creates the recommended shape with literally no arguments and prints the next steps", async () => {
    const root = await temporary();
    const result = run(root, []);
    expect(result.status, result.stderr).toBe(0);
    expect((await readdir(root)).sort()).toEqual(["docs", "package.json"]);
    const config = parse(await readFile(path.join(root, "docs/vellym.config.yaml"), "utf8"));
    expect(config.setup).toEqual({ structure: "by-type", numbered: false });
    expect(config.ui.language).toBe("en");
    expect(config.contentRoot).toBeUndefined();
    expect(await readFile(path.join(root, "docs/.gitignore"), "utf8")).toBe("dist/\n");
    expect(result.stdout).toContain(path.join(root, "docs"));
    expect(result.stdout).toContain("npx vellym dev");
    expect(result.stdout).toContain("AGENTS.md:\nRead docs/VELLYM.md before starting work.");
    expect((await readdir(path.join(root, "docs")))).toContain("overview");
  });

  it.each(["docs", "vellym", "."] as const)("creates the selected management root %s", async (managementRoot) => {
    const root = await temporary();
    const result = run(root, ["--root", managementRoot, "--language", "ja"]);
    expect(result.status, result.stderr).toBe(0);
    const prefix = path.join(root, managementRoot);
    for (const file of ["vellym.config.yaml", "VELLYM.md", "index.yaml", ".gitignore"]) await access(path.join(prefix, file));
    const guidePath = `${managementRoot === "." ? "" : `${managementRoot}/`}VELLYM.md`;
    expect(result.stdout).toContain(`作業前に${guidePath}を読んでください。`);
    expect(result.stdout).toContain(prefix);
    expect(parse(await readFile(path.join(prefix, "index.yaml"), "utf8")).spec.locale).toBe("ja");
  });

  for (const structure of ["by-type", "by-phase", "by-feature"] as const) {
    for (const numbered of [undefined, true, false]) {
      it(`${structure} numbering ${numbered ?? "default"} uses the shared planner`, async () => {
        const root = await temporary();
        const args = ["--structure", structure, "--language", "en", "--dry-run", "--json"];
        if (numbered !== undefined) args.push(numbered ? "--numbered" : "--no-numbered");
        const result = run(root, args);
        expect(result.status, result.stderr).toBe(0);
        const actual = JSON.parse(result.stdout);
        const expected = await planInit(root, {
          root: "docs", structure,
          numbered: numbered ?? loadCatalog().structures.find(item => item.id === structure)!.numberedByDefault,
          supplementGuide: false, plugins: [], language: "en", hostVersion: version
        });
        expect(actual.files).toEqual(expected.files);
        expect(actual.planHash).toBe(expected.planHash);
        expect(await readdir(root)).toEqual([]);
      });
    }
  }

  it("adds guide folders without changing the chosen structure", async () => {
    const root = await temporary();
    const result = run(root, ["--structure", "by-feature", "--with-guide-folders", "--language", "en"]);
    expect(result.status, result.stderr).toBe(0);
    await access(path.join(root, "docs/guide/tutorials/_index.yaml"));
    expect(parse(await readFile(path.join(root, "docs/vellym.config.yaml"), "utf8")).setup.structure).toBe("by-feature");
    expect(await readFile(path.join(root, "docs/index.yaml"), "utf8")).toContain("guide/tutorials");
  });

  it.each([
    [{ LANG: "ja_JP.UTF-8" }, "ja"],
    [{ LANG: "fr_FR.UTF-8" }, "en"],
    [{ LANG: "ja_JP", LC_MESSAGES: "en_US" }, "en"],
    [{ LANG: "en_US", LC_MESSAGES: "en_US", LC_ALL: "ja_JP.UTF-8" }, "ja"],
    [{ LANG: "", LC_MESSAGES: "", LC_ALL: "" }, "en"]
  ] as const)("selects document and message language from environment %j", async (env, language) => {
    const root = await temporary();
    const result = run(root, [], env);
    expect(result.status, result.stderr).toBe(0);
    expect(parse(await readFile(path.join(root, "docs/vellym.config.yaml"), "utf8")).ui.language).toBe(language);
    expect(result.stdout).toContain(language === "ja" ? "初期化しました" : "Vellym workspace created");
  });

  it("lets --language override the environment", async () => {
    const root = await temporary();
    const result = run(root, ["--language", "en"], { LC_ALL: "ja_JP" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Vellym workspace created");
    expect(parse(await readFile(path.join(root, "docs/index.yaml"), "utf8")).spec.locale).toBe("en");
  });

  it("accepts inline values and a project root after options", async () => {
    const root = await temporary();
    const target = path.join(root, "inline");
    const result = run(root, ["--language=ja", "--root=vellym", "--structure=by-phase", "--no-numbered", target]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("初期化しました");
    const config = parse(await readFile(path.join(target, "vellym/vellym.config.yaml"), "utf8"));
    expect(config.ui.language).toBe("ja");
    expect(config.setup).toEqual({ structure: "by-phase", numbered: false });
    const rejected = run(root, ["--language=ja", "--size=personal"]);
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toContain("廃止しました");
  });

  it.each(["ja", "en"])("explains every new option in %s help", async (language) => {
    const root = await temporary();
    const result = run(root, ["--help", "--language", language]);
    expect(result.status, result.stderr).toBe(0);
    for (const option of ["[project root]", "--root", "--structure", "--numbered", "--no-numbered", "--with-guide-folders", "--language", "--plugins", "--dry-run", "--json"]) expect(result.stdout).toContain(option);
    for (const option of ["--size", "--method", "--level", "--content-root", "--use-existing-content-root"]) expect(result.stdout).not.toContain(option);
    expect(result.stdout).toContain(language === "ja" ? "番号" : "Number folders");
    expect(await readdir(root)).toEqual([]);
  });

  it("prints create, skip and update without altering any existing files", async () => {
    const root = await temporary();
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "docs/index.yaml"), "custom\n");
    await writeFile(path.join(root, "package.json"), '{"name":"existing","scripts":{"test":"keep"}}\n');
    const before = await readdir(path.join(root, "docs"));
    const result = run(root, ["--dry-run", "--json", "--plugins", "tickets,tickets"]);
    expect(result.status, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout);
    expect(plan.skip).toEqual(["docs/index.yaml"]);
    expect(plan.create).toContain("docs/VELLYM.md");
    expect(plan.update).toEqual(["package.json"]);
    expect(plan.request.plugins).toHaveLength(1);
    expect(await readdir(path.join(root, "docs"))).toEqual(before);
    expect(await readFile(path.join(root, "docs/index.yaml"), "utf8")).toBe("custom\n");
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe('{"name":"existing","scripts":{"test":"keep"}}\n');
    const text = run(root, ["--dry-run"]);
    expect(text.stdout).toContain("create: docs/VELLYM.md");
    expect(text.stdout).toContain("skip: docs/index.yaml");
    expect(text.stdout).toContain("update: package.json");
  });

  it("plans a nonexistent project root without creating it and creates it on apply", async () => {
    const root = await temporary();
    const target = path.join(root, "new", "project");
    const preview = run(root, [target, "--dry-run", "--json"]);
    expect(preview.status, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout).projectRoot).toBe(target);
    expect(await readdir(root)).toEqual([]);
    const applied = run(root, [target, "--json"]);
    expect(applied.status, applied.stderr).toBe(0);
    const plan = JSON.parse(applied.stdout);
    expect(plan.files).toEqual(JSON.parse(preview.stdout).files);
    expect(JSON.parse(await readFile(path.join(target, "package.json"), "utf8")).name).toBe("project");
  });

  it.each(["--size", "--method", "--level", "--content-root", "--use-existing-content-root"])("rejects %s even before help or invalid argument parsing", async (option) => {
    const root = await temporary();
    const result = run(root, [path.join(root, "new"), "--bad", `${option}=old`, "--help"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("has been removed");
    expect(result.stderr).toContain("vellym init my-project --root docs --structure by-type");
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    ["--root", "content"], ["--structure", "unknown"], ["--language", "fr"],
    ["--root"], ["--structure"], ["--language"], ["--plugins"],
    ["--numbered", "--no-numbered"], ["one", "two"],
    ["--plan"], ["--template", "welcome"], ["--profile", "software-basic"], ["--unknown"]
  ])("rejects invalid usage %j without writing anything", async (...args) => {
    const root = await temporary();
    const result = run(root, args);
    expect(result.status, result.stderr).toBe(2);
    expect(await readdir(root)).toEqual([]);
  });
});
