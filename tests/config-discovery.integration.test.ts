import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { discoverConfig } from "../packages/runtime-node/src/config-discovery.js";

const cli = path.resolve("packages/vellym/dist/cli.mjs");

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "vellym-config-discovery-"));
}

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8"
  });
}

async function writeValidConfig(root: string): Promise<string> {
  await mkdir(path.join(root, "docs"), { recursive: true });
  const config = path.join(root, "vellym.config.yaml");
  await writeFile(
    config,
    `schemaVersion: "1.0"
contentRoot: docs
outputDir: dist
ui:
  language: ja
i18n:
  defaultLocale: ja
static:
  publicBaseUrl: https://example.test/
plugins: []
`
  );
  return config;
}

describe("discoverConfig", () => {
  it("returns no candidates when none of the supported paths exists", async () => {
    const cwd = await tempProject();

    expect(await discoverConfig(cwd)).toEqual({ candidates: [] });
  });

  it.each([
    ["current directory", "vellym.config.yaml"],
    ["docs directory", path.join("docs", "vellym.config.yaml")],
    ["vellym directory", path.join("vellym", "vellym.config.yaml")]
  ])("finds a config in the %s", async (_label, relativePath) => {
    const cwd = await tempProject();
    const config = path.join(cwd, relativePath);
    await mkdir(path.dirname(config), { recursive: true });
    await writeFile(config, "");

    expect(await discoverConfig(cwd)).toEqual({
      path: config,
      candidates: [config]
    });
  });

  it("returns all candidates in priority order when multiple configs exist", async () => {
    const cwd = await tempProject();
    const candidates = [
      path.join(cwd, "vellym.config.yaml"),
      path.join(cwd, "docs", "vellym.config.yaml"),
      path.join(cwd, "vellym", "vellym.config.yaml")
    ];
    await Promise.all(
      candidates.map(async (candidate) => {
        await mkdir(path.dirname(candidate), { recursive: true });
        await writeFile(candidate, "");
      })
    );

    expect(await discoverConfig(cwd)).toEqual({ candidates });
  });
});

describe("CLI config discovery", () => {
  it("reports every ambiguous path and asks for --config in Japanese and English", async () => {
    const cwd = await tempProject();
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    const candidates = [
      path.join(cwd, "vellym.config.yaml"),
      path.join(cwd, "docs", "vellym.config.yaml")
    ];
    await Promise.all(candidates.map((candidate) => writeFile(candidate, "")));

    const japanese = run(["validate"], cwd);
    expect(japanese.status).toBe(2);
    expect(japanese.stderr).toContain("設定ファイルが複数見つかりました");
    expect(japanese.stderr).toContain("--config");
    for (const candidate of candidates) expect(japanese.stderr).toContain(candidate);

    const english = run(["validate", "--language", "en"], cwd);
    expect(english.status).toBe(2);
    expect(english.stderr).toContain("Multiple configuration files were found");
    expect(english.stderr).toContain("--config");
    for (const candidate of candidates) expect(english.stderr).toContain(candidate);
  });

  it("does not search when --config is given", async () => {
    const cwd = await tempProject();
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await Promise.all([
      writeFile(path.join(cwd, "vellym.config.yaml"), ""),
      writeFile(path.join(cwd, "docs", "vellym.config.yaml"), "")
    ]);
    const explicitRoot = path.join(cwd, "custom");
    const config = await writeValidConfig(explicitRoot);

    const result = run(["validate", "--config", config], cwd);

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("検証結果:");
    expect(result.stderr).not.toContain("複数見つかりました");
  });

  it("preserves the existing missing-config error when discovery finds nothing", async () => {
    const cwd = await tempProject();

    const result = run(["validate"], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("設定ファイルが見つかりません");
    expect(result.stderr).toContain(path.join(cwd, "vellym.config.yaml"));
  });
});
