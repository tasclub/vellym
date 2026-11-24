import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMigration,
  loadRepository,
  planMigration
} from "@vellym-internal/runtime-node";

async function fixture(): Promise<{ root: string; config: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-migration-"));
  const content = path.join(root, "content");
  await mkdir(content);
  await writeFile(
    path.join(root, "vellym.config.yaml"),
    'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: ja\nplugins: []\n',
    "utf8"
  );
  await writeFile(
    path.join(content, "_index.yaml"),
    `# folder comment
apiVersion: vellym.tasclub.com/v1alpha1
kind: Folder
metadata:
  title: Documents
  vendor: keep
spec:
  order:
    - page.yaml
`,
    "utf8"
  );
  await writeFile(
    path.join(content, "page.yaml"),
    `# page comment
apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: migration-page
  title: Migration page
  vendor: keep
spec:
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: |
        Keep this body.
    - id: vendor
      type: example.com/widget
      payload: keep
`,
    "utf8"
  );
  return { root, config: path.join(root, "vellym.config.yaml") };
}

describe("v1 migration", () => {
  it("migrates Page and Folder while preserving comments and unknown values", async () => {
    const { root, config } = await fixture();
    const plan = await planMigration(config);
    expect(plan.files.map((file) => file.relativePath)).toEqual([
      "_index.yaml",
      "page.yaml"
    ]);
    expect(plan.diagnostics).toEqual([]);

    await applyMigration(plan);

    const folder = await readFile(path.join(root, "content/_index.yaml"), "utf8");
    const page = await readFile(path.join(root, "content/page.yaml"), "utf8");
    expect(folder).toContain("# folder comment");
    expect(folder).toContain("apiVersion: vellym.tasclub.com/v1");
    expect(folder).toContain("vendor: keep");
    expect(page).toContain("# page comment");
    expect(page).toContain("type: example.com/widget");
    expect(page).toContain("payload: keep");
    expect((await loadRepository(path.join(root, "content"))).pages).toHaveLength(1);
    expect((await planMigration(config)).files).toEqual([]);
  });

  it("aborts when a target changes after preview", async () => {
    const { root, config } = await fixture();
    const plan = await planMigration(config);
    await writeFile(
      path.join(root, "content/page.yaml"),
      `${await readFile(path.join(root, "content/page.yaml"), "utf8")}# external change\n`,
      "utf8"
    );
    await expect(applyMigration(plan)).rejects.toMatchObject({
      code: "MIGRATION_PLAN_CONFLICT"
    });
    expect(await readFile(path.join(root, "content/_index.yaml"), "utf8"))
      .toContain("v1alpha1");
  });

  it("reports malformed YAML and refuses to apply", async () => {
    const { root, config } = await fixture();
    await writeFile(path.join(root, "content/broken.yaml"), "metadata: [\n", "utf8");
    const plan = await planMigration(config);
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({ file: "broken.yaml", code: "MIGRATION_YAML" })
    ]);
    await expect(applyMigration(plan)).rejects.toMatchObject({
      code: "MIGRATION_DIAGNOSTICS"
    });
  });

  it("refuses aliases instead of rewriting unsafe YAML", async () => {
    const { root, config } = await fixture();
    await writeFile(
      path.join(root, "content/alias.yaml"),
      `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata: &metadata
  name: alias-page
  title: Alias page
copied: *metadata
spec:
  blocks: []
`,
      "utf8"
    );
    const plan = await planMigration(config);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "alias.yaml", code: "MIGRATION_UNSAFE_YAML" })
      ])
    );
  });
});
