import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  applyStructureChange,
  applyStructureUndo,
  listArchived,
  loadRepository,
  planStructureChange
} from "@vellym-internal/runtime-node";

function pageSource(name: string, title: string): string {
  return `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: ${name}
  title: ${title}
spec:
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: ""
`;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-structure-"));
  await mkdir(path.join(root, "existing"), { recursive: true });
  await writeFile(
    path.join(root, "existing/page.yaml"),
    pageSource("existing-page", "Existing"),
    "utf8"
  );
  return root;
}

describe("structure plan and apply", () => {
  it("previews without mutation and creates folders and pages safely", async () => {
    const root = await fixture();
    const folderPlan = await planStructureChange(root, {
      type: "create-folder",
      name: "新しいフォルダ",
      parentPath: ""
    });

    expect(folderPlan.executable).toBe(true);
    expect(folderPlan.changes).toEqual([
      {
        operation: "create",
        destination: "新しいフォルダ"
      }
    ]);
    expect(await readdir(root)).not.toContain("新しいフォルダ");

    await applyStructureChange(root, folderPlan);
    const pagePlan = await planStructureChange(root, {
      type: "create-page",
      title: "新しいページ",
      parentPath: "新しいフォルダ"
    });
    expect(pagePlan.input).toMatchObject({
      type: "create-page",
      pageId: expect.stringMatching(/^page-[a-f0-9]{24}$/)
    });
    expect(pagePlan.changes[0]?.destination).toBe(
      "新しいフォルダ/新しいページ.yaml"
    );

    await applyStructureChange(root, pagePlan);
    const repository = await loadRepository(root);
    expect(repository.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          view: expect.objectContaining({
            relativePath: "新しいフォルダ/新しいページ.yaml"
          })
        })
      ])
    );
    expect(repository.folders.some((folder) =>
      folder.path === "新しいフォルダ"
    )).toBe(true);

    // 新規作成は安定版のapiVersionで書き出す。v1alpha1の既存Pageは読めるままにする。
    expect(
      await readFile(path.join(root, "新しいフォルダ/新しいページ.yaml"), "utf8")
    ).toContain("apiVersion: vellym.tasclub.com/v1\n");
  });

  it("updates folder metadata and explicit child order", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "existing/second.yaml"),
      pageSource("second-page", "Second"),
      "utf8"
    );
    const metadata = await planStructureChange(root, {
      type: "update-folder",
      folderPath: "existing",
      title: "表示名",
      description: "説明"
    });
    await applyStructureChange(root, metadata);
    const order = await planStructureChange(root, {
      type: "reorder",
      folderPath: "existing",
      order: ["second.yaml", "page.yaml"]
    });
    await applyStructureChange(root, order);

    const source = await readFile(path.join(root, "existing/_index.yaml"), "utf8");
    expect(source).toContain("apiVersion: vellym.tasclub.com/v1\n");
    expect(source).toContain("title: 表示名");
    expect(source).toContain("description: 説明");
    expect(source.indexOf("second.yaml")).toBeLessThan(source.indexOf("page.yaml"));
    const repository = await loadRepository(root);
    expect(repository.folders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "existing",
          title: "表示名",
          order: ["second.yaml", "page.yaml"]
        })
      ])
    );
  });

  it("moves and archives without deleting the source content", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "destination"));
    const move = await planStructureChange(root, {
      type: "move-page",
      pageId: "existing-page",
      destinationPath: "destination"
    });
    await applyStructureChange(root, move);
    expect(
      await readFile(path.join(root, "destination/page.yaml"), "utf8")
    ).toContain("name: existing-page");

    const archive = await planStructureChange(root, {
      type: "archive-page",
      pageId: "existing-page"
    });
    expect(archive.warnings.join(" ")).toContain("復元");
    await applyStructureChange(root, archive);
    expect((await loadRepository(root)).byName.has("existing-page")).toBe(false);
    expect(
      await readFile(
        path.join(root, "_archive/destination/page.yaml"),
        "utf8"
      )
    ).toContain("name: existing-page");

    await mkdir(path.join(root, "bundle"));
    await writeFile(
      path.join(root, "bundle/nested.yaml"),
      pageSource("nested-page", "Nested"),
      "utf8"
    );
    const folderArchive = await planStructureChange(root, {
      type: "archive-folder",
      folderPath: "bundle"
    });
    expect(folderArchive).toMatchObject({
      affectedPages: 1,
      warnings: expect.arrayContaining([
        expect.stringContaining("空でないフォルダ")
      ])
    });
    await applyStructureChange(root, folderArchive);
    expect((await loadRepository(root)).byName.has("nested-page")).toBe(false);
    expect(
      await readFile(path.join(root, "_archive/bundle/nested.yaml"), "utf8")
    ).toContain("name: nested-page");
  });

  it("lists and restores an archived page to its original location", async () => {
    const root = await fixture();
    await applyStructureChange(
      root,
      await planStructureChange(root, {
        type: "archive-page",
        pageId: "existing-page"
      })
    );
    expect((await loadRepository(root)).byName.has("existing-page")).toBe(false);

    expect(await listArchived(root)).toEqual([
      { archivePath: "existing/page.yaml", type: "page", title: "Existing" }
    ]);

    const restore = await planStructureChange(root, {
      type: "restore",
      archivePath: "existing/page.yaml"
    });
    expect(restore.executable).toBe(true);
    expect(restore.changes).toEqual([
      {
        operation: "restore",
        source: "_archive/existing/page.yaml",
        destination: "existing/page.yaml"
      }
    ]);
    await applyStructureChange(root, restore);
    expect((await loadRepository(root)).byName.has("existing-page")).toBe(true);
    expect(
      await readFile(path.join(root, "existing/page.yaml"), "utf8")
    ).toContain("name: existing-page");
    expect(await listArchived(root)).toEqual([]);
  });

  it("restores a whole archived folder", async () => {
    const root = await fixture();
    await applyStructureChange(
      root,
      await planStructureChange(root, {
        type: "archive-folder",
        folderPath: "existing"
      })
    );
    // The live folder is gone, so it is listed as a single folder entry.
    expect(await listArchived(root)).toEqual([
      { archivePath: "existing", type: "folder", title: "existing" }
    ]);

    const restore = await planStructureChange(root, {
      type: "restore",
      archivePath: "existing"
    });
    expect(restore.executable).toBe(true);
    await applyStructureChange(root, restore);
    expect((await loadRepository(root)).byName.has("existing-page")).toBe(true);
  });

  it("refuses to restore when the original parent folder is gone", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "_archive/ghost"), { recursive: true });
    await writeFile(
      path.join(root, "_archive/ghost/page.yaml"),
      pageSource("ghost-page", "Ghost"),
      "utf8"
    );
    const plan = await planStructureChange(root, {
      type: "restore",
      archivePath: "ghost/page.yaml"
    });
    expect(plan.executable).toBe(false);
    expect(plan.conflict).toContain("親フォルダ");
  });

  it("renames a page file without changing its internal ID", async () => {
    const root = await fixture();
    const plan = await planStructureChange(root, {
      type: "rename-page-file",
      pageId: "existing-page",
      fileName: "read-me"
    });
    expect(plan).toMatchObject({
      executable: true,
      changes: [{
        operation: "move",
        source: "existing/page.yaml",
        destination: "existing/read-me.yaml"
      }]
    });
    await applyStructureChange(root, plan);
    const repository = await loadRepository(root);
    expect(repository.byName.get("existing-page")?.view.relativePath)
      .toBe("existing/read-me.yaml");
  });

  it("moves with an exact destination order and restores path and metadata", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "destination"));
    const sourceIndex = `apiVersion: vellym.tasclub.com/v1alpha1
kind: Folder
metadata:
  title: Existing
spec:
  order:
    - page.yaml
`;
    const destinationIndex = `apiVersion: vellym.tasclub.com/v1alpha1
kind: Folder
metadata:
  title: Destination
spec:
  order: []
`;
    await writeFile(path.join(root, "existing/_index.yaml"), sourceIndex, "utf8");
    await writeFile(
      path.join(root, "destination/_index.yaml"),
      destinationIndex,
      "utf8"
    );
    const plan = await planStructureChange(root, {
      type: "move-page",
      pageId: "existing-page",
      destinationPath: "destination",
      destinationOrder: ["page.yaml"]
    });
    const applied = await applyStructureChange(root, plan);
    expect(applied.undoPlan).toBeDefined();
    expect(
      await readFile(path.join(root, "destination/_index.yaml"), "utf8")
    ).toContain("- page.yaml");

    await applyStructureUndo(root, applied.undoPlan!);
    expect(await readFile(path.join(root, "existing/page.yaml"), "utf8"))
      .toContain("name: existing-page");
    expect(await readFile(path.join(root, "existing/_index.yaml"), "utf8"))
      .toBe(sourceIndex);
    expect(await readFile(path.join(root, "destination/_index.yaml"), "utf8"))
      .toBe(destinationIndex);
  });

  it("refuses undo after an external repository change", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "destination"));
    const plan = await planStructureChange(root, {
      type: "move-page",
      pageId: "existing-page",
      destinationPath: "destination",
      destinationOrder: ["page.yaml"]
    });
    const applied = await applyStructureChange(root, plan);
    await writeFile(path.join(root, "external.txt"), "changed", "utf8");

    await expect(
      applyStructureUndo(root, applied.undoPlan!)
    ).rejects.toMatchObject({
      status: 409,
      code: "STRUCTURE_UNDO_CONFLICT"
    });
    expect(await readFile(path.join(root, "destination/page.yaml"), "utf8"))
      .toContain("name: existing-page");
  });

  it("rejects apply when the repository changed after preview", async () => {
    const root = await fixture();
    const plan = await planStructureChange(root, {
      type: "create-folder",
      name: "planned",
      parentPath: ""
    });
    await writeFile(path.join(root, "external.txt"), "changed", "utf8");

    await expect(applyStructureChange(root, plan)).rejects.toMatchObject({
      status: 409,
      code: "STRUCTURE_PLAN_CONFLICT"
    });
    expect(await readdir(root)).not.toContain("planned");
  });

  it("does not create reserved or case-insensitively conflicting folders", async () => {
    const root = await fixture();
    const reserved = await planStructureChange(root, {
      type: "create-folder",
      name: "_archive",
      parentPath: ""
    });
    const caseConflict = await planStructureChange(root, {
      type: "create-folder",
      name: "EXISTING",
      parentPath: ""
    });

    expect(reserved).toMatchObject({
      executable: false,
      conflict: expect.stringContaining("予約名")
    });
    expect(caseConflict).toMatchObject({
      executable: false,
      conflict: expect.stringContaining("大文字小文字")
    });
  });
});
