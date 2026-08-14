import { access, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyProjectSetup,
  loadRepository,
  planProjectSetup,
  type SetupPlan,
  type SetupPlanFile
} from "@vellym-internal/runtime-node";

async function root(label: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `vellym-${label}-`));
}

function file(plan: SetupPlan, nodeId: string): SetupPlanFile | undefined {
  return plan.files.find((entry) => entry.nodeId === nodeId);
}

const NESTED = {
  mode: "templates" as const,
  selectedTemplateIds: ["arc42-context"],
  language: "ja" as const
};

describe("hierarchical setup plan", () => {
  it("creates three levels of folders with an _index.yaml holding only direct children", async () => {
    const target = await root("hier-nested");
    const plan = await planProjectSetup(target, NESTED);
    await applyProjectSetup(plan);

    const rootIndex = await readFile(path.join(target, "docs/_index.yaml"), "utf8");
    expect(rootIndex).toContain("- 03_アーキテクチャ");
    expect(rootIndex).not.toContain("01_arc42");

    const area = await readFile(
      path.join(target, "docs/03_アーキテクチャ/_index.yaml"),
      "utf8"
    );
    expect(area).toContain("- 01_arc42");
    expect(area).not.toContain("コンテキストとスコープ");
    expect(area).not.toContain("vellym.tasclub.com/information-area-id");

    const leaf = await readFile(
      path.join(target, "docs/03_アーキテクチャ/01_arc42/_index.yaml"),
      "utf8"
    );
    expect(leaf).toContain("- 03_コンテキストとスコープ.yaml");
    expect(leaf).not.toContain("vellym.tasclub.com/setup-folder-id");

    const repository = await loadRepository(path.join(target, "docs"));
    expect(repository.diagnostics).toHaveLength(0);
    expect(repository.pages).toHaveLength(1);
  });

  it("does not touch the filesystem while previewing", async () => {
    const target = await root("hier-preview");
    await planProjectSetup(target, NESTED);
    await expect(access(path.join(target, "docs"))).rejects.toThrow();
    await expect(access(path.join(target, "vellym.config.yaml"))).rejects.toThrow();
  });

  it("reuses an existing directory without rewriting its _index.yaml", async () => {
    const target = await root("hier-reuse");
    const areaDirectory = path.join(target, "docs/03_アーキテクチャ");
    await mkdir(areaDirectory, { recursive: true });
    const existingIndex = `apiVersion: vellym.tasclub.com/v1alpha1
kind: Folder
metadata:
  title: 自分で作ったフォルダ
spec:
  locale: ja
  order: []
`;
    await writeFile(path.join(areaDirectory, "_index.yaml"), existingIndex, "utf8");

    const plan = await planProjectSetup(target, NESTED);
    expect(file(plan, "area-architecture")?.status).toBe("reuse");
    expect(file(plan, "arc-arc42")?.status).toBe("create");
    await applyProjectSetup(plan);

    expect(await readFile(path.join(areaDirectory, "_index.yaml"), "utf8")).toBe(existingIndex);
    expect(
      await readFile(path.join(areaDirectory, "01_arc42/_index.yaml"), "utf8")
    ).toContain("- 03_コンテキストとスコープ.yaml");
  });

  it("marks the whole subtree as conflicting when a file occupies a folder path", async () => {
    const target = await root("hier-ancestor");
    await mkdir(path.join(target, "docs"), { recursive: true });
    await writeFile(path.join(target, "docs/03_アーキテクチャ"), "not a folder", "utf8");

    const plan = await planProjectSetup(target, NESTED);
    expect(file(plan, "area-architecture")).toMatchObject({
      status: "conflict",
      conflictReason: "ancestor"
    });
    expect(file(plan, "arc-arc42")).toMatchObject({
      status: "skip",
      conflictReason: "ancestor"
    });
    expect(file(plan, "arc42-context")).toMatchObject({
      status: "skip",
      conflictReason: "ancestor"
    });
    await expect(applyProjectSetup(plan)).rejects.toMatchObject({
      code: "SETUP_FILE_CONFLICT"
    });
  });

  it("resolves an ancestor conflict by renaming the folder, and the rename reaches every descendant", async () => {
    const target = await root("hier-rename");
    await mkdir(path.join(target, "docs"), { recursive: true });
    await writeFile(path.join(target, "docs/03_アーキテクチャ"), "not a folder", "utf8");

    const plan = await planProjectSetup(target, {
      ...NESTED,
      folderNames: { "area-architecture": "03_設計判断" }
    });
    expect(file(plan, "area-architecture")?.status).toBe("create");
    expect(file(plan, "arc42-context")?.relativePath).toBe(
      "docs/03_設計判断/01_arc42/03_コンテキストとスコープ.yaml"
    );
    await applyProjectSetup(plan);
    expect(await readFile(path.join(target, "docs/03_アーキテクチャ"), "utf8")).toBe(
      "not a folder"
    );
    expect(
      await readFile(path.join(target, "docs/03_設計判断/_index.yaml"), "utf8")
    ).toContain("- 01_arc42");
  });

  it("accepts folder names keyed by the pre-hierarchy information area id", async () => {
    const target = await root("hier-legacy-key");
    const plan = await planProjectSetup(target, {
      ...NESTED,
      folderNames: { architecture: "03_構造" }
    });
    expect(file(plan, "arc42-context")?.relativePath).toBe(
      "docs/03_構造/01_arc42/03_コンテキストとスコープ.yaml"
    );
  });

  it("generates an explicitly selected folder even with no pages, and drops derived empty ones", async () => {
    const target = await root("hier-empty-folder");
    const plan = await planProjectSetup(target, {
      mode: "templates",
      selectedTemplateIds: [],
      selectedFolderIds: ["arc-adr"],
      language: "ja"
    });
    // Selecting a folder selects its subtree, so its one page comes along.
    expect(plan.selectedTemplateIds).toEqual(["decision-log"]);

    const withoutPage = await planProjectSetup(target, {
      mode: "templates",
      selectedTemplateIds: [],
      selectedFolderIds: ["arc-models"],
      language: "ja"
    });
    expect(withoutPage.selectedFolderIds).toContain("arc-models");

    const nothing = await planProjectSetup(target, {
      mode: "templates",
      selectedTemplateIds: [],
      selectedFolderIds: [],
      language: "ja"
    });
    expect(nothing.files.some((entry) => entry.folderId)).toBe(false);
  });

  it("keeps preview and generated tree identical", async () => {
    const target = await root("hier-consistency");
    const plan = await planProjectSetup(target, {
      mode: "recommended",
      size: "medium-large",
      method: "waterfall",
      level: "strict",
      language: "ja"
    });
    await applyProjectSetup(plan);

    for (const entry of plan.files) {
      if (entry.status !== "create") continue;
      await expect(
        access(path.join(target, entry.relativePath)),
        entry.relativePath
      ).resolves.toBeUndefined();
    }
    // Nothing outside the plan appears under the content root.
    const planned = new Set(
      plan.files.filter((entry) => entry.status === "create").map((entry) => entry.relativePath)
    );
    const walk = async (relative: string): Promise<void> => {
      for (const item of await readdir(path.join(target, relative), { withFileTypes: true })) {
        const next = path.posix.join(relative, item.name);
        if (item.isDirectory()) await walk(next);
        else expect(planned, next).toContain(next);
      }
    };
    await walk("docs");
  });

  it("aborts when the filesystem changes between plan and apply", async () => {
    const target = await root("hier-stale");
    const plan = await planProjectSetup(target, NESTED);
    await mkdir(path.join(target, "docs/03_アーキテクチャ/01_arc42"), { recursive: true });
    await writeFile(
      path.join(target, "docs/03_アーキテクチャ/01_arc42/03_コンテキストとスコープ.yaml"),
      "external",
      "utf8"
    );
    await expect(applyProjectSetup(plan)).rejects.toMatchObject({
      code: "SETUP_PLAN_CONFLICT"
    });
    expect(
      await readFile(
        path.join(target, "docs/03_アーキテクチャ/01_arc42/03_コンテキストとスコープ.yaml"),
        "utf8"
      )
    ).toBe("external");
  });

  it("skips a page already generated from the same template instead of copying it into the new layout", async () => {
    const target = await root("hier-provenance");
    const initial = await planProjectSetup(target, NESTED);
    await applyProjectSetup(initial);

    const again = await planProjectSetup(target, {
      ...NESTED,
      operation: "add",
      contentRoot: "docs"
    });
    expect(file(again, "arc42-context")).toMatchObject({
      status: "skip",
      conflictReason: "template-existing"
    });
    expect(again.files.some((entry) => entry.kind === "page" && entry.status === "create")).toBe(
      false
    );
  });

  it("adds a new template into an existing hierarchy without changing existing folders", async () => {
    const target = await root("hier-add");
    const initial = await planProjectSetup(target, NESTED);
    await applyProjectSetup(initial);
    const areaIndexBefore = await readFile(
      path.join(target, "docs/03_アーキテクチャ/_index.yaml"),
      "utf8"
    );
    const rootIndexBefore = await readFile(path.join(target, "docs/_index.yaml"), "utf8");

    const added = await planProjectSetup(target, {
      operation: "add",
      mode: "templates",
      selectedTemplateIds: ["decision-log"],
      contentRoot: "docs",
      language: "ja"
    });
    expect(file(added, "area-architecture")?.status).toBe("reuse");
    expect(file(added, "arc-adr")?.status).toBe("create");
    await applyProjectSetup(added);

    expect(await readFile(path.join(target, "docs/03_アーキテクチャ/_index.yaml"), "utf8")).toBe(
      areaIndexBefore
    );
    expect(await readFile(path.join(target, "docs/_index.yaml"), "utf8")).toBe(rootIndexBefore);
    expect(
      await readFile(path.join(target, "docs/03_アーキテクチャ/02_ADR/_index.yaml"), "utf8")
    ).toContain("- ADR一覧.yaml");
  });

  it("rolls back the files it created when a write fails partway", async () => {
    const target = await root("hier-rollback");
    const leafDirectory = path.join(target, "docs/03_アーキテクチャ/01_arc42");
    await mkdir(leafDirectory, { recursive: true });
    // A dangling symlink is invisible to the pre-write existence check but makes
    // the exclusive write fail, so the plan is stable while the apply breaks
    // after the folder and root files are already on disk.
    await symlink(
      path.join(target, "missing-target.yaml"),
      path.join(leafDirectory, "03_コンテキストとスコープ.yaml")
    );

    const plan = await planProjectSetup(target, NESTED);
    expect(file(plan, "arc42-context")?.status).toBe("create");
    await expect(applyProjectSetup(plan)).rejects.toThrow();

    await expect(access(path.join(target, "docs/_index.yaml"))).rejects.toThrow();
    await expect(access(path.join(target, "vellym.config.yaml"))).rejects.toThrow();
  });
});
