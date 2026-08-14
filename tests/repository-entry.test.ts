import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deriveRepositoryEntryIndex,
  extractPageEntry,
  type PageEntry
} from "../packages/runtime-node/src/repository-entry.js";
import { loadRepository } from "../packages/runtime-node/src/repository.js";

function extract(source: string) {
  return extractPageEntry({
    sourcePath: "/project/docs/page.yaml",
    relativePath: "page.yaml",
    source,
    mtimeMs: 123,
    size: Buffer.byteLength(source)
  });
}

describe("repository page entry extraction", () => {
  it("derives a self-contained searchable entry without retaining markdown", () => {
    const result = extract(`apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: search-page
  title: 検索の設計
  slug: search-design
  labels: { area: core }
spec:
  documentType: architecture-decision
  locale: ja
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: |
        ## 方針

        [[linked-page]]へ進む。\n
  translations:
    en:
      title: Search design
      blocks:
        - id: body
          type: rich-text
          format: commonmark
          content: "## Policy\\n\\nSearch the normalized text."
`);
    expect(result.kind).toBe("entry");
    if (result.kind !== "entry") return;
    expect(result.entry).toMatchObject({
      name: "search-page",
      slug: "search-design",
      documentType: "architecture-decision",
      configuredBaseLocale: "ja",
      labels: { area: "core" },
      availableLocales: ["en"],
      outgoingPageIds: ["linked-page"],
      mtimeMs: 123
    });
    expect(result.entry.base.normalizedText).toBe("方針\n[[linked-page]]へ進む。");
    expect(result.entry.base.headingData).toEqual([0, "方針", "方針"]);
    expect(result.entry.translations?.get("en")?.normalizedTitle).toBe("search design");
    expect(JSON.stringify(result.entry)).not.toContain("## Policy");
  });

  it("isolates malformed YAML as diagnostics", () => {
    const result = extract("kind: Page\nmetadata: [\n");
    expect(result.kind).toBe("invalid");
    expect(result.diagnostics[0]).toMatchObject({ code: "YAML_PARSE", file: "page.yaml" });
  });

  it("marks aliases and multiple documents read-only without source tokens", () => {
    const result = extract(`apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata: &metadata
  name: alias-page
  title: Alias
spec:
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: Body
---
ignored: true
`);
    expect(result.kind).toBe("entry");
    if (result.kind !== "entry") return;
    expect(result.entry.readOnly).toBe(true);
    expect(result.entry.readOnlyReasons).toContain("複数YAML documentを含むため編集できません");
    expect(result.entry.readOnlyReasons).toContain("anchorを含むため編集できません");
  });
});

describe("repository entry cross-file derivation", () => {
  function entry(name: string, slug: string, relativePath: string): PageEntry {
    const result = extract(`apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata: { name: ${name}, title: ${name}, slug: ${slug} }
spec:
  blocks:
    - { id: body, type: rich-text, format: commonmark, content: "[[target-page]]" }
`);
    if (result.kind !== "entry") throw new Error("fixture extraction failed");
    return { ...result.entry, relativePath };
  }

  it("derives duplicate diagnostics and backlinks without file access", () => {
    const index = deriveRepositoryEntryIndex([
      entry("first-page", "shared", "b.yaml"),
      entry("second-page", "shared", "a.yaml"),
      entry("first-page", "other", "c.yaml")
    ]);
    expect(index.pages.map(({ relativePath }) => relativePath)).toEqual(["a.yaml", "b.yaml"]);
    expect(index.diagnostics.filter(({ code }) => code === "DUPLICATE_PAGE_ID")).toHaveLength(2);
    expect(index.diagnostics.filter(({ code }) => code === "DUPLICATE_PAGE_SLUG")).toHaveLength(2);
    expect(index.byName.get("first-page")?.readOnly).toBe(true);
    expect(index.backlinks.get("target-page")).toEqual(["first-page", "second-page"]);
  });

  it("removes cross-file read-only state when a duplicate is resolved", () => {
    const duplicated = deriveRepositoryEntryIndex([
      entry("first-page", "shared", "a.yaml"),
      entry("second-page", "shared", "b.yaml")
    ]);
    expect(duplicated.byName.get("first-page")?.readOnly).toBe(true);

    const resolved = deriveRepositoryEntryIndex([
      duplicated.byName.get("first-page")!
    ]);
    expect(resolved.byName.get("first-page")?.readOnly).toBe(false);
    expect(resolved.byName.get("first-page")?.readOnlyReasons).toBeUndefined();
    expect(resolved.diagnostics).toEqual([]);
  });
});

describe("repository incremental reload", () => {
  const yaml = (name: string, body: string) => `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata: { name: ${name}, title: ${name} }
spec:
  blocks:
    - { id: body, type: rich-text, format: commonmark, content: ${JSON.stringify(body)} }
`;

  it("reuses unchanged file entries and replaces only changed files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-entry-reload-"));
    await writeFile(path.join(root, "first.yaml"), yaml("first", "before"));
    await writeFile(path.join(root, "second.yaml"), yaml("second", "stable"));
    const first = await loadRepository(root);
    const oldFirst = first.entryIndex.byName.get("first");
    const oldSecond = first.entryIndex.byName.get("second");

    await writeFile(path.join(root, "first.yaml"), yaml("first", "after with a new size"));
    const second = await loadRepository(root, first);
    expect(second.entryIndex.byName.get("first")?.base).not.toBe(oldFirst?.base);
    expect(second.entryIndex.byName.get("second")?.base).toBe(oldSecond?.base);
    expect(second.entryIndex.byName.get("first")?.base.normalizedText)
      .toContain("after with a new size");
  });
});
