import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../packages/runtime-node/src/config.js";

describe("asset configuration", () => {
  let directory = "";
  const previous = process.env.VELLYM_ASSETS_DIR;
  afterEach(async () => {
    if (previous === undefined) delete process.env.VELLYM_ASSETS_DIR;
    else process.env.VELLYM_ASSETS_DIR = previous;
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("resolves defaults and gives the environment override precedence", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "vellym-assets-config-"));
    const file = path.join(directory, "vellym.config.yaml");
    const base = 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n';
    delete process.env.VELLYM_ASSETS_DIR;
    await writeFile(file, base);
    expect(await loadConfig(file)).toMatchObject({ assetsRoot: path.join(directory, "assets"), assetsMaxBytes: 10485760 });
    await writeFile(file, `${base}assets:\n  root: pictures\n  maxBytes: 1234\n`);
    expect(await loadConfig(file)).toMatchObject({ assetsRoot: path.join(directory, "pictures"), assetsMaxBytes: 1234 });
    process.env.VELLYM_ASSETS_DIR = path.join(directory, "override");
    expect((await loadConfig(file)).assetsRoot).toBe(path.join(directory, "override"));
  });
});
