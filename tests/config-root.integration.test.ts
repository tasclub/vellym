import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { loadConfig, planContentRootChange } from "../packages/runtime-node/src/config.js";
import { excludedDirectoriesFor } from "../packages/runtime-node/src/management-root.js";
import { loadRepository, localizedFolderSummaries } from "../packages/runtime-node/src/repository.js";
import { applyStructureChange, planStructureChange } from "../packages/runtime-node/src/structure.js";

const roots: string[] = [];
const base = { schemaVersion: "1.0", ui: { language: "ja" }, plugins: [] };
const page = `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: page-000000000000000000000001
  title: Home
spec:
  blocks: []
`;

async function fixture(config: object = base) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vellym-config-root-"));
  roots.push(root);
  const configPath = path.join(root, "vellym.config.yaml");
  await writeFile(configPath, stringify(config));
  return { root, configPath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("management-root configuration", () => {
  it.each([undefined, "."])("defaults paths with contentRoot %s", async (contentRoot) => {
    const { root, configPath } = await fixture({ ...base, contentRoot });
    const loaded = await loadConfig(configPath);
    expect(loaded.contentRoot).toBe(root);
    expect(loaded.outputDir).toBe(path.join(root, "dist"));
    expect(loaded.config.contentRoot).toBe(".");
    expect(loaded.config.outputDir).toBe("dist");
    await writeFile(path.join(root, "index.yaml"), page);
    await writeFile(path.join(root, "VELLYM.md"), "# Guide");
    await writeFile(path.join(root, "package.json"), "{}");
    for (const directory of ["dist", "assets"]) {
      await mkdir(path.join(root, directory));
      await writeFile(path.join(root, directory, "invalid.yaml"), "apiVersion: broken");
    }
    const snapshot = await loadRepository(root);
    expect(snapshot.pages).toHaveLength(1);
    expect(snapshot.diagnostics).toEqual([]);
    expect(localizedFolderSummaries(snapshot, "ja", "ja").map((folder) => folder.path)).toEqual([""]);
    expect((await planContentRootChange(configPath, ".")).pages).toBe(1);
  });

  it("excludes custom nested paths and prevents direct structure operations", async () => {
    const { root } = await fixture({
      ...base, outputDir: "generated/site", assets: { root: "media/images" }
    });
    await writeFile(path.join(root, "index.yaml"), page);
    for (const directory of ["generated/site", "media/images"]) {
      await mkdir(path.join(root, directory), { recursive: true });
      await writeFile(path.join(root, directory, "bad.yaml"), "apiVersion: broken");
      await expect(planStructureChange(root, {
        type: "create-page", title: "Blocked", parentPath: directory
      })).rejects.toMatchObject({ code: "STRUCTURE_BOUNDARY" });
      await expect(planStructureChange(root, {
        type: "archive-folder", folderPath: directory
      })).rejects.toMatchObject({ code: "STRUCTURE_BOUNDARY" });
    }
    const snapshot = await loadRepository(root);
    expect(snapshot.pages).toHaveLength(1);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.folders.map((folder) => folder.path)).toEqual(["", "generated", "media"]);
    await expect(planStructureChange(root, {
      type: "archive-folder", folderPath: "media"
    })).rejects.toMatchObject({ code: "STRUCTURE_BOUNDARY" });
    const plan = await planStructureChange(root, { type: "create-page", title: "New" });
    await writeFile(path.join(root, "generated/site/changing.txt"), "output changed");
    await applyStructureChange(root, plan);
    expect((await loadRepository(root)).diagnostics).toEqual([]);
    expect(await readFile(path.join(root, "_index.yaml"), "utf8")).not.toContain("vellym.config.yaml");
  });

  it("invalidates cached exclusions on config updates and removal", async () => {
    const { root, configPath } = await fixture();
    expect(await excludedDirectoriesFor(root)).toEqual([path.join(root, "dist"), path.join(root, "assets")]);
    await writeFile(configPath, stringify({ ...base, outputDir: "site", assets: { root: "images" } }));
    const future = new Date(Date.now() + 10000);
    await utimes(configPath, future, future);
    expect(await excludedDirectoriesFor(root)).toEqual([path.join(root, "site"), path.join(root, "images")]);
    await rm(configPath);
    expect(await excludedDirectoriesFor(root)).toEqual([]);
  });

  it.each(["docs/site", "docs", "."])("rejects overlapping legacy output %s", async (outputDir) => {
    const { configPath } = await fixture({ ...base, contentRoot: "docs", outputDir });
    await expect(loadConfig(configPath)).rejects.toMatchObject({ code: "OUTPUT_DIR" });
  });

  it("preserves the separate content layout and does not infer exclusions from unrelated config", async () => {
    const { root, configPath } = await fixture({ ...base, contentRoot: "content", outputDir: "site" });
    await mkdir(path.join(root, "content/assets"), { recursive: true });
    await writeFile(path.join(root, "content/index.yaml"), page);
    const loaded = await loadConfig(configPath);
    expect(loaded.contentRoot).toBe(path.join(root, "content"));
    expect(loaded.outputDir).toBe(path.join(root, "site"));
    expect(await excludedDirectoriesFor(root)).toEqual([]);
    expect(await excludedDirectoriesFor(loaded.contentRoot)).toEqual([]);
    const snapshot = await loadRepository(loaded.contentRoot);
    expect(snapshot.pages).toHaveLength(1);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.folders.map((folder) => folder.path)).toContain("assets");
  });

  it.each([".", "..", "../outside"])("rejects unsafe management-root output %s", async (outputDir) => {
    const { configPath } = await fixture({ ...base, outputDir });
    await expect(loadConfig(configPath)).rejects.toMatchObject({ code: "OUTPUT_DIR" });
  });
});
