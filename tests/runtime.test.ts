import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  loadRepository,
  loadCanonicalPage,
  localizedFolderSummaries,
  localizedPage,
  localizedPageSummaries,
  localizedSearchRepository,
  pageLocaleHashes,
  folderLocaleHashes,
  applySlugMigration,
  planSlugMigration,
  pageSummaries,
  applyProjectSetup,
  planProjectSetup,
  setupCatalog,
  parsePagePatch,
  parseFolderPatch,
  saveFolder,
  savePage,
  searchRepository,
  startDevServer,
  RuntimeError
} from "@vellym-internal/runtime-node";

function source(name = "test-page"): string {
  return `# page comment
apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: ${name}
  title: Before
  vendorValue: keep-me
spec:
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: |
        Before body
    # vendor block comment
    - type: vendor.example/widget
      payload:
        preserved: true
`;
}

function multilingualSource(): string {
  return `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: multilingual
  title: 日本語タイトル
  slug: multilingual
spec:
  locale: ja
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: 日本語だけの本文
  translations:
    en:
      title: English title
      blocks:
        - id: body
          type: rich-text
          format: commonmark
          content: English-only body
    fr:
      visibility: draft
      title: Brouillon
      blocks: []
`;
}

// fetchはHostヘッダを差し替えられないため、Host検証の確認だけnode:httpで送る。
function requestWithHost(
  serverUrl: string,
  host: string
): Promise<{ status: number; body: string }> {
  const target = new URL("/api/v1/bootstrap", serverUrl);
  return new Promise((resolve, reject) => {
    const call = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "GET",
        headers: { Host: host }
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body })
        );
      }
    );
    call.on("error", reject);
    call.end();
  });
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-runtime-"));
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "nested/page.yaml"), source(), "utf8");
  return root;
}

describe("page repository and save", () => {
  it("loads nested pages and ignores foreign YAML", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "foreign.yaml"),
      "apiVersion: example.com/v1\nkind: Page\nanything: true\n",
      "utf8"
    );
    const repository = await loadRepository(root);
    expect(repository.pages).toHaveLength(1);
    expect(repository.diagnostics).toHaveLength(0);
  });

  it("keeps dot paths outside every repository projection", async () => {
    const root = await fixture();
    await mkdir(path.join(root, ".guides"), { recursive: true });
    await writeFile(
      path.join(root, ".guides/hidden.yaml"),
      source("hidden-page"),
      "utf8"
    );
    await writeFile(path.join(root, ".broken.yaml"), "value: [broken\n", "utf8");
    const repository = await loadRepository(root);
    expect(repository.pages).toHaveLength(1);
    expect(repository.byName.has("hidden-page")).toBe(false);
    expect(searchRepository(repository, "hidden-page").total).toBe(0);
    expect(repository.diagnostics).toHaveLength(0);
  });

  it("isolates malformed YAML", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "broken.yaml"), "value: [broken\n", "utf8");
    const repository = await loadRepository(root);
    expect(repository.pages).toHaveLength(1);
    expect(repository.diagnostics.some((item) => item.code === "YAML_PARSE")).toBe(true);
  });

  it("patches known nodes and preserves comments and unknown values", async () => {
    const root = await fixture();
    const repository = await loadRepository(root);
    const loaded = repository.byName.get("test-page")!;
    await savePage(root, loaded, {
      baseHash: loaded.hash,
      title: "After",
      richTextBlocks: [{ id: "body", content: "After body" }]
    });
    const output = await readFile(path.join(root, loaded.relativePath), "utf8");
    expect(output).toContain("# page comment");
    expect(output).toContain("vendorValue: keep-me");
    expect(output).toContain("vendor.example/widget");
    expect(output).toContain("preserved: true");
    expect(output).toContain("title: After");
    expect(output).toContain("After body");
  });

  it("adds, publishes, and removes a translation atomically while preserving unknown blocks", async () => {
    const root = await fixture();
    const loaded = (await loadRepository(root)).byName.get("test-page")!;
    await savePage(root, loaded, {
      baseHash: loaded.hash,
      localeChanges: [{
        locale: "en",
        operation: "create",
        initialize: { type: "copy", sourceLocale: "ja" },
        title: "English title",
        richTextBlocks: [{ id: "body", content: "English body" }]
      }]
    }, "ja");

    let repository = await loadRepository(root);
    let page = repository.byName.get("test-page")!;
    let canonicalPage = await loadCanonicalPage(root, page);
    expect(canonicalPage.spec.locale).toBe("ja");
    expect(canonicalPage.spec.translations?.en).toMatchObject({
      visibility: "draft",
      title: "English title",
      blocks: [
        expect.objectContaining({ id: "body", content: "English body" }),
        expect.objectContaining({ type: "vendor.example/widget" })
      ]
    });
    expect((await readFile(path.join(root, page.relativePath), "utf8")).match(/# vendor block comment/g))
      .toHaveLength(2);
    expect(await localizedPage(repository, "test-page", "en", "ja")).toMatchObject({
      locale: "ja",
      requestedLocale: "en",
      availableLocales: ["ja"],
      page: { metadata: { title: "Before" } }
    });

    await expect(savePage(root, page, {
      baseHash: page.hash,
      localeChanges: [{
        locale: "en",
        operation: "update",
        baselineHash: "a".repeat(64),
        title: "Stale edit"
      }]
    }, "ja")).rejects.toMatchObject({
      code: "LOCALE_BASELINE_CONFLICT",
      path: "/spec/translations/en"
    });

    await savePage(root, page, {
      baseHash: page.hash,
      localeChanges: [{
        locale: "en",
        operation: "update",
        baselineHash: pageLocaleHashes(canonicalPage, "ja").en,
        visibility: "published",
        title: "Published English",
        richTextBlocks: [{ id: "body", content: "Published body" }]
      }]
    }, "ja");
    repository = await loadRepository(root);
    page = repository.byName.get("test-page")!;
    expect(await localizedPage(repository, "test-page", "en", "ja")).toMatchObject({
      locale: "en",
      page: { metadata: { title: "Published English" } }
    });

    await savePage(root, page, {
      baseHash: page.hash,
      removeLocales: ["en"]
    }, "ja");
    repository = await loadRepository(root);
    canonicalPage = await loadCanonicalPage(root, repository.byName.get("test-page")!);
    expect(canonicalPage.spec.translations?.en)
      .toBeUndefined();
  });

  it("keeps the original file when a multilingual save fails validation", async () => {
    const root = await fixture();
    const loaded = (await loadRepository(root)).byName.get("test-page")!;
    const before = await readFile(path.join(root, loaded.relativePath), "utf8");
    await expect(savePage(root, loaded, {
      baseHash: loaded.hash,
      localeChanges: [
        {
          locale: "en",
          operation: "create",
          initialize: { type: "empty" }
        },
        {
          locale: "fr",
          operation: "create",
          visibility: "published",
          initialize: { type: "empty" }
        }
      ]
    }, "ja")).rejects.toMatchObject({ code: "SAVE_VALIDATION" });
    expect(await readFile(path.join(root, loaded.relativePath), "utf8")).toBe(before);
  });

  it("repairs an invalid translation and creates another draft in one save", async () => {
    const root = await fixture();
    const file = path.join(root, "nested/page.yaml");
    await writeFile(
      file,
      `${source().replace("spec:\n", "spec:\n  locale: ja\n")}  translations:
    en:
      title: 42
      blocks:
        - id: body
          type: rich-text
          format: commonmark
          content: English
`,
      "utf8"
    );
    const loaded = (await loadRepository(root)).byName.get("test-page")!;
    await savePage(root, loaded, {
      baseHash: loaded.hash,
      localeChanges: [
        {
          locale: "en",
          operation: "update",
          title: "Repaired English"
        },
        {
          locale: "fr",
          operation: "create",
          initialize: { type: "empty" }
        }
      ]
    }, "ja");
    const page = await loadCanonicalPage(
      root,
      (await loadRepository(root)).byName.get("test-page")!
    );
    expect(page.spec.translations?.en).toMatchObject({ title: "Repaired English" });
    expect(page.spec.translations?.fr).toMatchObject({ visibility: "draft" });
  });

  it("deletes an invalid raw translation key only when explicitly targeted", async () => {
    const root = await fixture();
    const file = path.join(root, "nested/page.yaml");
    await writeFile(
      file,
      `${source().replace("spec:\n", "spec:\n  locale: ja\n")}  translations:\n    "bad key!":\n      title: 42\n      blocks: []\n`,
      "utf8"
    );
    const loaded = (await loadRepository(root)).byName.get("test-page")!;
    await savePage(root, loaded, {
      baseHash: loaded.hash,
      removeTranslationKeys: ["bad key!"]
    }, "ja");
    expect(await readFile(file, "utf8")).not.toContain("bad key!");
  });

  it("reports all targeted locales when the Page hash conflicts", async () => {
    const root = await fixture();
    const loaded = (await loadRepository(root)).byName.get("test-page")!;
    await writeFile(path.join(root, loaded.relativePath), `${source()}\n# external\n`, "utf8");
    await expect(savePage(root, loaded, {
      baseHash: loaded.hash,
      localeChanges: [{
        locale: "en",
        operation: "create",
        initialize: { type: "empty" }
      }],
      removeLocales: ["fr"]
    }, "ja")).rejects.toMatchObject({
      status: 409,
      code: "HASH_CONFLICT",
      message: expect.stringContaining("en、fr")
    });
  });

  it("does not overwrite an external change", async () => {
    const root = await fixture();
    const repository = await loadRepository(root);
    const loaded = repository.byName.get("test-page")!;
    await writeFile(
      path.join(root, loaded.relativePath),
      source().replace("Before", "External"),
      "utf8"
    );
    await expect(
      savePage(root, loaded, { baseHash: loaded.hash, title: "After" })
    ).rejects.toMatchObject({ status: 409, code: "HASH_CONFLICT" });
    expect(await readFile(path.join(root, loaded.relativePath), "utf8")).toContain("External");
  });

  it("marks multi-document YAML read-only", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "nested/page.yaml"),
      `${source()}---\nanything: else\n`,
      "utf8"
    );
    const loaded = (await loadRepository(root)).byName.get("test-page")!;
    expect(loaded.readOnly).toBe(true);
  });

  it("does not impose a fixed page-count limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-limit-"));
    await Promise.all(
      Array.from({ length: 101 }, (_, index) => {
        const name = `page-${String(index).padStart(3, "0")}`;
        return writeFile(path.join(root, `${name}.yaml`), source(name), "utf8");
      })
    );
    const repository = await loadRepository(root);
    expect(repository.pages).toHaveLength(101);
    expect(repository.byName.has("page-100")).toBe(true);
    expect(pageSummaries(repository)).toHaveLength(101);
    expect(searchRepository(repository, "Before").total).toBe(202);
    expect(repository.diagnostics).toHaveLength(0);
  });

  it("projects multilingual repository reads without duplicating canonical resources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-i18n-repository-"));
    await mkdir(path.join(root, "guide"), { recursive: true });
    await writeFile(path.join(root, "guide/page.yaml"), multilingualSource(), "utf8");
    await writeFile(path.join(root, "guide/ja-only.yaml"), `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: ja-only
  title: 日本語のみ
spec:
  locale: ja
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: 既定言語だけの本文
`, "utf8");
    await writeFile(
      path.join(root, "guide/_index.yaml"),
      `apiVersion: vellym.tasclub.com/v1alpha1
kind: Folder
metadata:
  title: ガイド
spec:
  locale: ja
  translations:
    en:
      title: Guide
`,
      "utf8"
    );
    const repository = await loadRepository(root);
    expect(repository.pages).toHaveLength(2);
    expect(repository.folderResources.get("guide")?.resource.metadata.title).toBe("ガイド");
    expect(localizedPageSummaries(repository, "en", "ja")).toEqual([
      expect.objectContaining({ name: "ja-only", title: "日本語のみ", locale: "ja" }),
      expect.objectContaining({ name: "multilingual", title: "English title", locale: "en" })
    ]);
    expect(localizedPageSummaries(repository, "fr", "ja")).toEqual([
      expect.objectContaining({ name: "ja-only", title: "日本語のみ", locale: "ja" }),
      expect.objectContaining({ name: "multilingual", title: "日本語タイトル", locale: "ja" })
    ]);
    expect(localizedFolderSummaries(repository, "en", "ja")).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "guide", title: "Guide" })])
    );
    expect(localizedSearchRepository(repository, "English-only", "en", "ja")).toMatchObject({
      total: 1,
      results: [{ pageId: "multilingual", title: "English title" }]
    });
    expect(localizedSearchRepository(repository, "日本語だけ", "en", "ja").total).toBe(0);
    expect(localizedSearchRepository(repository, "既定言語だけ", "en", "ja")).toMatchObject({
      indexedPages: 2,
      total: 1,
      results: [expect.objectContaining({ pageId: "ja-only", title: "日本語のみ" })]
    });
    expect(localizedSearchRepository(repository, "日本語だけ", "fr", "ja").total).toBe(1);
    expect(await localizedPage(repository, "multilingual", "en", "ja")).toMatchObject({
      locale: "en",
      requestedLocale: "en",
      baseLocale: "ja",
      availableLocales: ["ja", "en"],
      page: { metadata: { title: "English title" } }
    });
    expect(await localizedPage(repository, "multilingual", "fr", "ja")).toMatchObject({
      locale: "ja",
      requestedLocale: "fr",
      baseLocale: "ja",
      availableLocales: ["ja", "en"],
      page: { metadata: { title: "日本語タイトル" } }
    });
  });

  it("adds, publishes, and removes Folder translations with hash protection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-folder-save-"));
    await mkdir(path.join(root, "guide"), { recursive: true });
    await writeFile(path.join(root, "guide/page.yaml"), multilingualSource(), "utf8");
    await writeFile(
      path.join(root, "guide/_index.yaml"),
      `# folder comment
apiVersion: vellym.tasclub.com/v1alpha1
kind: Folder
metadata:
  title: ガイド
  vendor: keep
spec:
  description: 日本語説明
  order:
    - page.yaml
`,
      "utf8"
    );
    let repository = await loadRepository(root);
    let folder = repository.folderResources.get("guide")!;
    await saveFolder(root, {
      folderPath: "guide",
      baseHash: folder.hash,
      localeChanges: [{
        locale: "en",
        operation: "create",
        initialize: { type: "copy", sourceLocale: "ja" },
        title: "Guide",
        description: "English description"
      }],
      removeLocales: []
    }, "ja");
    repository = await loadRepository(root);
    folder = repository.folderResources.get("guide")!;
    const englishBaseline = folderLocaleHashes(folder.resource, "ja").en;
    expect(folder.resource.spec.locale).toBe("ja");
    expect(folder.resource.spec.translations?.en).toMatchObject({
      visibility: "draft",
      title: "Guide",
      description: "English description"
    });
    expect(await readFile(folder.sourcePath, "utf8")).toContain("# folder comment");
    expect(await readFile(folder.sourcePath, "utf8")).toContain("vendor: keep");

    await saveFolder(root, {
      folderPath: "guide",
      baseHash: folder.hash,
      localeChanges: [{
        locale: "en",
        operation: "update",
        baselineHash: englishBaseline,
        visibility: "published"
      }],
      removeLocales: []
    }, "ja");
    repository = await loadRepository(root);
    folder = repository.folderResources.get("guide")!;
    expect(localizedFolderSummaries(repository, "en", "ja")).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "guide", title: "Guide" })])
    );

    await saveFolder(root, {
      folderPath: "guide",
      baseHash: folder.hash,
      localeChanges: [],
      removeLocales: ["en"]
    }, "ja");
    repository = await loadRepository(root);
    expect(repository.folderResources.get("guide")!.resource.spec.translations?.en)
      .toBeUndefined();
  });

  it("creates missing Folder metadata only after a valid null-hash save", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-folder-create-"));
    await mkdir(path.join(root, "new-folder"));
    const patch = parseFolderPatch({
      folderPath: "new-folder",
      baseHash: null,
      localeChanges: [{
        locale: "en",
        operation: "create",
        initialize: { type: "copy", sourceLocale: "ja" }
      }],
      removeLocales: []
    });
    await saveFolder(root, patch, "ja");
    const output = await readFile(path.join(root, "new-folder/_index.yaml"), "utf8");
    expect(output).toContain("locale: ja");
    expect(output).toContain("title: new-folder");
    await expect(saveFolder(root, patch, "ja")).rejects.toMatchObject({
      status: 409,
      code: "HASH_CONFLICT"
    });
  });

  it("serves list and page endpoints on an available port", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "vellym-server-"));
    const root = path.join(project, "docs/content");
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "nested/page.yaml"), source(), "utf8");
    const configPath = path.join(project, "vellym.config.yaml");
    await writeFile(
      configPath,
      `schemaVersion: "1.0"
contentRoot: docs/content
outputDir: dist/vellym
ui:
  language: ja
plugins: []
`,
      "utf8"
    );
    const ui = await mkdtemp(path.join(tmpdir(), "vellym-ui-"));
    await writeFile(path.join(ui, "index.html"), "<h1>UI</h1>", "utf8");
    const server = await startDevServer({
      configPath,
      uiRoot: ui,
      host: "0.0.0.0",
      port: 0
    });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
      const bootstrap = await fetch(`${server.url}/api/v1/bootstrap`);
      expect(bootstrap.status).toBe(200);
      expect(await bootstrap.json()).toMatchObject({
        data: {
          state: "ready",
          project: {
            contentRoot: "docs/content",
            configPath: "vellym.config.yaml"
          },
          capabilities: {
            repository: true,
            search: true,
            structure: true
          }
        }
      });
      const list = await fetch(`${server.url}/api/v1/repository`);
      expect(list.status).toBe(200);
      const folderUpdated = await fetch(`${server.url}/api/v1/folders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: "nested",
          baseHash: null,
          localeChanges: [{
            locale: "en",
            operation: "create",
            initialize: { type: "copy", sourceLocale: "ja" },
            title: "Nested"
          }],
          removeLocales: []
        })
      });
      expect(folderUpdated.status).toBe(200);
      expect(await readFile(path.join(root, "nested/_index.yaml"), "utf8"))
        .toContain("locale: ja");
      const folderEdit = await (
        await fetch(`${server.url}/api/v1/folders/edit?path=nested`)
      ).json() as {
        data: {
          hash: string;
          locales: Array<{ locale: string; baselineHash: string }>;
        } & Record<string, unknown>;
      };
      expect(folderEdit.data).toMatchObject({
        folderPath: "nested",
        hash: expect.any(String),
        baseLocale: "ja",
        locales: [
          { locale: "ja", isBaseLocale: true, baselineHash: expect.any(String) },
          { locale: "en", title: "Nested", baselineHash: expect.any(String) }
        ]
      });
      const folderSavedTogether = await fetch(`${server.url}/api/v1/folders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: "nested",
          baseHash: folderEdit.data.hash,
          localeChanges: [
            {
              locale: "ja",
              operation: "update",
              baselineHash: folderEdit.data.locales.find(({ locale }) => locale === "ja")!.baselineHash,
              title: "ネスト文書"
            },
            {
              locale: "en",
              operation: "update",
              baselineHash: folderEdit.data.locales.find(({ locale }) => locale === "en")!.baselineHash,
              title: "Nested documents",
              visibility: "published"
            }
          ],
          removeLocales: []
        })
      });
      expect(folderSavedTogether.status).toBe(200);
      expect(await readFile(path.join(root, "nested/_index.yaml"), "utf8"))
        .toContain("title: Nested documents");
      const detail = await fetch(`${server.url}/api/v1/pages/test-page`);
      expect(detail.status).toBe(200);
      const search = await fetch(`${server.url}/api/v1/search?q=Before`);
      expect(search.status).toBe(200);
      expect(await search.json()).toMatchObject({
        data: {
          query: "Before",
          total: 2,
          results: [
            { pageId: "test-page", title: "Before" },
            { pageId: "test-page", title: "Before" }
          ]
        }
      });
      expect(
        (await fetch(`${server.url}/api/v1/search?q=`)).status
      ).toBe(400);
      const events = await fetch(`${server.url}/api/v1/events`);
      expect(events.status).toBe(200);
      const eventReader = events.body!.getReader();
      const firstEvent = await eventReader.read();
      await eventReader.cancel();
      const eventText = new TextDecoder().decode(firstEvent.value);
      expect(eventText).toContain("retry: 1000");
      expect(eventText).toContain('"kind":"connected"');
      expect(eventText).toMatch(
        /"watcher":"(?:connecting|connected)"/
      );
      const detailBody = await detail.json() as {
        data: { hash: string };
      };
      const invalid = await fetch(`${server.url}/api/v1/pages/test-page`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseHash: "invalid" })
      });
      expect(invalid.status).toBe(400);
      const localeConflict = await fetch(`${server.url}/api/v1/pages/test-page`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseHash: "a".repeat(64),
          localeChanges: [{
            locale: "en",
            operation: "create",
            initialize: { type: "empty" }
          }]
        })
      });
      expect(localeConflict.status).toBe(409);
      expect(await localeConflict.json()).toMatchObject({
        diagnostics: [{
          code: "HASH_CONFLICT",
          path: "/spec/translations",
          message: expect.stringContaining("en")
        }]
      });
      const forbidden = await fetch(`${server.url}/api/v1/pages/test-page`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://example.com"
        },
        body: JSON.stringify({ baseHash: detailBody.data.hash, title: "Forbidden" })
      });
      expect(forbidden.status).toBe(403);
      const updated = await fetch(`${server.url}/api/v1/pages/test-page`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseHash: detailBody.data.hash, title: "From API" })
      });
      expect(updated.status).toBe(200);
      expect(await readFile(path.join(root, "nested/page.yaml"), "utf8")).toContain(
        "title: From API"
      );
      const structurePreview = await fetch(
        `${server.url}/api/v1/structure/plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "create-folder",
            name: "planned",
            parentPath: ""
          })
        }
      );
      expect(structurePreview.status).toBe(200);
      const structurePlan = await structurePreview.json() as {
        data: { planHash: string; changes: unknown[] };
      };
      await expect(access(path.join(root, "planned"))).rejects.toThrow();
      const structureApply = await fetch(
        `${server.url}/api/v1/structure/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: structurePlan.data })
        }
      );
      expect(structureApply.status).toBe(200);
      expect((await readdir(root))).toContain("planned");
    } finally {
      await server.close();
    }
  });

  it("serves locale projections and structured missing translations over HTTP", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "vellym-i18n-server-"));
    const root = path.join(project, "docs/content");
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "page.yaml"),
      multilingualSource().replace("slug: multilingual", "slug: multilingual-guide"),
      "utf8"
    );
    const configPath = path.join(project, "vellym.config.yaml");
    await writeFile(
      configPath,
      `schemaVersion: "1.0"
contentRoot: docs/content
outputDir: dist/vellym
ui:
  language: ja
i18n:
  defaultLocale: ja
plugins: []
`,
      "utf8"
    );
    const ui = await mkdtemp(path.join(tmpdir(), "vellym-i18n-ui-"));
    await writeFile(path.join(ui, "index.html"), "<h1>UI</h1>", "utf8");
    const server = await startDevServer({
      configPath,
      uiRoot: ui,
      host: "127.0.0.1",
      port: 0
    });
    try {
      const bootstrap = await (
        await fetch(`${server.url}/api/v1/bootstrap?locale=en`)
      ).json() as { data: Record<string, unknown> };
      expect(bootstrap.data).toMatchObject({
        project: {
          language: "ja",
          defaultLocale: "ja",
          requestedLocale: "en",
          resolvedLocale: "en",
          uiLocale: "en",
          availableLocales: ["ja", "en"]
        }
      });

      const repository = await (
        await fetch(`${server.url}/api/v1/repository?locale=en`)
      ).json() as { data: Record<string, unknown> };
      expect(repository.data).toMatchObject({
        locale: "en",
        defaultLocale: "ja",
        availableLocales: ["ja", "en"],
        pages: [{ name: "multilingual", title: "English title" }]
      });

      const detail = await (
        await fetch(`${server.url}/api/v1/pages/multilingual?locale=en`)
      ).json() as { data: Record<string, unknown> };
      expect(detail.data).toMatchObject({
        locale: "en",
        requestedLocale: "en",
        baseLocale: "ja",
        page: { metadata: { title: "English title" } }
      });

      const detailBySlug = await (
        await fetch(`${server.url}/api/v1/pages/multilingual-guide?locale=en`)
      ).json() as { data: Record<string, unknown> };
      expect(detailBySlug.data).toMatchObject({
        locale: "en",
        page: { metadata: { name: "multilingual", title: "English title" } }
      });

      const editDetail = await (
        await fetch(`${server.url}/api/v1/pages/multilingual-guide/edit`)
      ).json() as { data: Record<string, unknown> };
      expect(editDetail.data).toMatchObject({
        pageId: "multilingual",
        slug: "multilingual-guide",
        baseLocale: "ja",
        hash: expect.any(String),
        locales: [
          { locale: "ja", visibility: "published", baselineHash: expect.any(String) },
          { locale: "en", visibility: "published", baselineHash: expect.any(String) },
          { locale: "fr", visibility: "draft", baselineHash: expect.any(String) }
        ]
      });

      const spaRoute = await fetch(
        `${server.url}/en/pages/multilingual-guide/`
      );
      expect(spaRoute.status).toBe(200);
      expect(await spaRoute.text()).toContain("<h1>UI</h1>");

      const fallback = await fetch(
        `${server.url}/api/v1/pages/multilingual?locale=fr`
      );
      expect(fallback.status).toBe(200);
      expect(await fallback.json()).toMatchObject({
        data: {
          locale: "ja",
          requestedLocale: "fr",
          baseLocale: "ja",
          availableLocales: ["ja", "en"],
          page: { metadata: { title: "日本語タイトル" } }
        }
      });

      const search = await (
        await fetch(`${server.url}/api/v1/search?q=English-only&locale=en`)
      ).json() as { data: Record<string, unknown> };
      expect(search.data).toMatchObject({
        indexedPages: 1,
        total: 1,
        results: [{ pageId: "multilingual", title: "English title" }]
      });
      expect(
        (await fetch(`${server.url}/api/v1/repository?locale=en-u-ca-japanese`)).status
      ).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("limits the Host header while bound to loopback", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "vellym-host-"));
    const root = path.join(project, "docs/content");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "page.yaml"), source(), "utf8");
    const configPath = path.join(project, "vellym.config.yaml");
    await writeFile(
      configPath,
      `schemaVersion: "1.0"
contentRoot: docs/content
outputDir: dist/vellym
ui:
  language: ja
plugins: []
`,
      "utf8"
    );
    const ui = await mkdtemp(path.join(tmpdir(), "vellym-ui-host-"));
    await writeFile(path.join(ui, "index.html"), "<h1>UI</h1>", "utf8");
    const server = await startDevServer({
      configPath,
      uiRoot: ui,
      host: "127.0.0.1",
      port: 0
    });
    try {
      expect((await fetch(`${server.url}/api/v1/bootstrap`)).status).toBe(200);
      // DNS rebindingでは攻撃者のhost名でloopbackへ到達する。
      // fetchはHostを差し替えられないため、node:httpで直接送る。
      const rebound = await requestWithHost(server.url, "attacker.example");
      expect(rebound.status).toBe(403);
      expect(
        (await fetch(`${server.url}/api/v1/bootstrap`)).headers.get(
          "x-content-type-options"
        )
      ).toBe("nosniff");
      expect(
        (JSON.parse(rebound.body) as { diagnostics: Array<{ code: string }> })
          .diagnostics[0]?.code
      ).toBe("HOST");
      const allowed = await requestWithHost(server.url, "localhost");
      expect(allowed.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("serves UI assets with their own content type and 404s missing ones", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "vellym-assets-"));
    const root = path.join(project, "docs/content");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "page.yaml"), source(), "utf8");
    const configPath = path.join(project, "vellym.config.yaml");
    await writeFile(
      configPath,
      `schemaVersion: "1.0"
contentRoot: docs/content
outputDir: dist/vellym
ui:
  language: ja
plugins: []
`,
      "utf8"
    );
    const ui = await mkdtemp(path.join(tmpdir(), "vellym-ui-assets-"));
    await writeFile(
      path.join(ui, "index.html"),
      '<link rel="icon" href="./favicon.png"><script src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css"><h1>UI</h1>',
      "utf8"
    );
    await mkdir(path.join(ui, "assets"));
    await writeFile(path.join(ui, "assets/app.js"), "export {};", "utf8");
    await writeFile(path.join(ui, "assets/app.css"), "body {}", "utf8");
    await writeFile(path.join(ui, "favicon.png"), "icon", "utf8");
    await writeFile(
      path.join(ui, "icon.svg"),
      "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
      "utf8"
    );
    const server = await startDevServer({
      configPath,
      uiRoot: ui,
      host: "127.0.0.1",
      port: 0
    });
    try {
      const index = await fetch(`${server.url}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
      // Content-Typeを厳密化した意味を保つため、推測を禁止する。
      expect(index.headers.get("x-content-type-options")).toBe("nosniff");
      expect(index.headers.get("x-frame-options")).toBe("DENY");
      expect(index.headers.get("referrer-policy")).toBe("no-referrer");
      const svg = await fetch(`${server.url}/icon.svg`);
      expect(svg.status).toBe(200);
      expect(svg.headers.get("content-type")).toBe("image/svg+xml");
      // 存在しないアセットをindex.htmlで代替すると失敗が200のHTMLとして隠れる。
      expect((await fetch(`${server.url}/missing.png`)).status).toBe(404);
      // 拡張子のない経路はSPAのentryへ委ねる。
      const route = await fetch(`${server.url}/settings`);
      expect(route.status).toBe(200);
      expect(route.headers.get("content-type")).toBe("text/html; charset=utf-8");
      const deepRoute = await fetch(`${server.url}/en/pages/overview/`);
      const deepHtml = await deepRoute.text();
      expect(deepHtml).toContain('src="/assets/app.js"');
      expect(deepHtml).toContain('href="/assets/app.css"');
      expect(deepHtml).toContain('href="/favicon.png"');
      expect(deepHtml).not.toContain('="./assets/');
      expect((await fetch(`${server.url}/assets/app.css`)).headers.get("content-type"))
        .toBe("text/css; charset=utf-8");
      expect((await fetch(`${server.url}/favicon.png`)).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("starts uninitialized and becomes ready after browser setup", async () => {
    const project = await mkdtemp(
      path.join(tmpdir(), "vellym-server-setup-")
    );
    const ui = await mkdtemp(path.join(tmpdir(), "vellym-setup-ui-"));
    await writeFile(path.join(ui, "index.html"), "<h1>UI</h1>", "utf8");
    const server = await startDevServer({
      configPath: path.join(project, "vellym.config.yaml"),
      uiRoot: ui,
      port: 0
    });
    try {
      expect(
        await (await fetch(`${server.url}/api/v1/bootstrap`)).json()
      ).toMatchObject({
        data: {
          state: "setup",
          capabilities: { setup: true, repository: false }
        }
      });
      expect(
        (await fetch(`${server.url}/api/v1/repository`)).status
      ).toBe(409);
      const catalog = await fetch(
        `${server.url}/api/v1/setup/catalog`
      );
      expect(catalog.status).toBe(200);
      expect(await catalog.json()).toMatchObject({
        data: {
          packId: "vellym-core-project-structure",
          packVersion: "2.0.0",
          folders: expect.arrayContaining([
            expect.objectContaining({ id: "area-architecture" })
          ]),
          pages: expect.arrayContaining([
            expect.objectContaining({ id: "arc42-context", parentFolderId: "arc-arc42" })
          ])
        }
      });
      // The pre-hierarchy path stays available as an alias.
      expect((await fetch(`${server.url}/api/v1/setup/profiles`)).status).toBe(200);
      const input = {
        mode: "templates",
        selectedTemplateIds: ["welcome", "project-guide"],
        conflictResolutions: {},
        pageFileNames: { "project-guide": "start.yaml" }
      };
      const preview = await fetch(`${server.url}/api/v1/setup/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      expect(preview.status).toBe(200);
      const previewBody = await preview.json() as {
        data: { planHash: string; plannedPageIds: Record<string, string>; projectRoot?: string };
      };
      expect(previewBody.data.projectRoot).toBe(project);
      const applied = await fetch(`${server.url}/api/v1/setup/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          planHash: previewBody.data.planHash,
          plannedPageIds: previewBody.data.plannedPageIds
        })
      });
      expect(applied.status).toBe(200);
      expect(
        await (await fetch(`${server.url}/api/v1/bootstrap`)).json()
      ).toMatchObject({
        data: { state: "ready", capabilities: { repository: true } }
      });
      expect(
        (await fetch(`${server.url}/api/v1/repository`)).status
      ).toBe(200);
      expect(await readFile(path.join(project, "docs/start.yaml"), "utf8"))
        .toContain("プロジェクト文書の案内");
    } finally {
      await server.close();
    }
  });

  it("does not treat an invalid config as an uninitialized project", async () => {
    const project = await mkdtemp(
      path.join(tmpdir(), "vellym-server-invalid-config-")
    );
    const configPath = path.join(project, "vellym.config.yaml");
    await writeFile(configPath, "broken: [", "utf8");
    const ui = await mkdtemp(path.join(tmpdir(), "vellym-error-ui-"));
    await writeFile(path.join(ui, "index.html"), "<h1>UI</h1>", "utf8");
    const server = await startDevServer({
      configPath,
      uiRoot: ui,
      port: 0
    });
    try {
      expect(
        await (await fetch(`${server.url}/api/v1/bootstrap`)).json()
      ).toMatchObject({
        data: {
          state: "config-error",
          capabilities: { setup: false, repository: false }
        }
      });
      expect(
        (await fetch(`${server.url}/api/v1/setup/catalog`)).status
      ).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("keeps a plugin Resource in memory until its first save", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "vellym-plugin-draft-server-"));
    const root = path.join(project, "docs/content");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "page.yaml"), source(), "utf8");
    const pluginRoot = path.join(project, "node_modules/example-ticket-plugin");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(
      path.join(pluginRoot, "package.json"),
      JSON.stringify({
        name: "example-ticket-plugin",
        version: "1.0.0",
        type: "module",
        main: "index.mjs",
        engines: { vellym: ">=0.3.0-beta.1" },
        vellym: {
          id: "example-tickets",
          contributes: {
            kinds: [{ kind: "Ticket" }],
            commands: [
              { id: "ticket.create", title: { ja: "チケットを作成" }, static: false }
            ]
          }
        }
      }),
      "utf8"
    );
    await writeFile(
      path.join(pluginRoot, "index.mjs"),
      `export function activate(host) {
  host.registerKind({ kind: "Ticket" });
  host.registerCommand({
    id: "ticket.create",
    title: { ja: "チケットを作成" },
    static: false,
    run(context) {
      return context.createResource({
        kind: "Ticket",
        name: "ticket-draft-test",
        title: "新しいチケット",
        spec: {
          status: "todo",
          fields: { priority: "mid", readiness: "ready" },
          vendorValue: { keep: true },
          blocks: [{ id: "description", type: "rich-text", content: "" }]
        }
      });
    }
  });
}`,
      "utf8"
    );
    const configPath = path.join(project, "vellym.config.yaml");
    await writeFile(
      configPath,
      `schemaVersion: "1.0"
contentRoot: docs/content
outputDir: dist/vellym
ui:
  language: ja
plugins:
  - example-ticket-plugin
`,
      "utf8"
    );
    const ui = await mkdtemp(path.join(tmpdir(), "vellym-plugin-draft-ui-"));
    await writeFile(path.join(ui, "index.html"), "<h1>UI</h1>", "utf8");
    const server = await startDevServer({
      configPath,
      uiRoot: ui,
      hostVersion: "0.3.0-beta.1",
      port: 0
    });
    try {
      const before = (await readdir(root)).filter((file) => file.startsWith("ticket-"));
      const started = await fetch(`${server.url}/api/v1/plugins/commands/ticket.create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      expect(started.status).toBe(200);
      const startedBody = await started.json() as {
        data: { draft: Record<string, unknown>; relativePath: string };
      };
      expect(startedBody.data).toMatchObject({
        relativePath: "ticket-draft-test.yaml",
        draft: {
          kind: "Ticket",
          name: "ticket-draft-test",
          spec: { fields: { priority: "mid", readiness: "ready" } }
        }
      });
      // キャンセルや離脱は追加のHTTP操作をしない。commandだけでは1件も増えない。
      expect((await readdir(root)).filter((file) => file.startsWith("ticket-"))).toEqual(before);

      const saved = await fetch(`${server.url}/api/v1/plugins/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseHash: null, draft: startedBody.data.draft })
      });
      expect(saved.status).toBe(201);
      expect((await readdir(root)).filter((file) => file.startsWith("ticket-"))).toHaveLength(
        before.length + 1
      );
      const output = await readFile(path.join(root, "ticket-draft-test.yaml"), "utf8");
      expect(output).toContain("priority: mid");
      expect(output).toContain("readiness: ready");
      // UIが解釈しないspecも初回保存で落とさない。
      expect(output).toContain("vendorValue:");

      // null baselineの競合は既存ファイルを上書きしない。
      const conflict = await fetch(`${server.url}/api/v1/plugins/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseHash: null, draft: startedBody.data.draft })
      });
      expect(conflict.status).toBe(409);
      expect(await readFile(path.join(root, "ticket-draft-test.yaml"), "utf8")).toBe(output);
    } finally {
      await server.close();
    }
  });

  it("validates patch structure before touching a page", () => {
    expect(() => parsePagePatch({ baseHash: "short" })).toThrow("baseHash");
    expect(() =>
      parsePagePatch({
        baseHash: "a".repeat(64),
        richTextBlocks: [{ id: "body" }]
      })
    ).toThrow("richTextBlocks");
    expect(() => parsePagePatch({
      baseHash: "a".repeat(64),
      localeChanges: [{
        locale: "EN",
        operation: "create",
        initialize: { type: "empty" }
      }]
    })).toThrow("canonical locale");
    expect(() => parsePagePatch({
      baseHash: "a".repeat(64),
      localeChanges: [{ locale: "en", operation: "create" }]
    })).toThrow("initialize");
  });

  it("does not create a missing content root while reading", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-missing-root-"));
    const missing = path.join(root, "missing");
    await expect(loadRepository(missing)).rejects.toMatchObject({
      code: "CONTENT_ROOT_NOT_FOUND"
    });
    await expect(access(missing)).rejects.toThrow();
  });
});

describe("setup plan and apply", () => {
  it("creates the standard information-area layout and provenance", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-standard-"));
    const plan = await planProjectSetup(root, {
      mode: "recommended",
      size: "small-team",
      method: "hybrid",
      level: "standard",
      language: "ja"
    });
    await applyProjectSetup(plan);
    const requirement = await readFile(
      path.join(root, "docs/02_要求・要件/03_システム要件/機能要件.yaml"),
      "utf8"
    );
    // 生成物へprovenance annotationsは書かない。生成後は利用者が自由に書き換えるため、
    // 生成元を記録しても実態と乖離する。
    expect(requirement).toContain("kind: Page");
    expect(requirement).not.toContain("vellym.tasclub.com/setup-");
    expect(requirement).not.toContain("vellym.tasclub.com/template-");

    // Each level of the hierarchy gets its own _index.yaml listing only its
    // direct children.
    const area = await readFile(path.join(root, "docs/02_要求・要件/_index.yaml"), "utf8");
    expect(area).toContain("- 03_システム要件");
    expect(area).not.toContain("機能要件.yaml");
    const subfolder = await readFile(
      path.join(root, "docs/02_要求・要件/03_システム要件/_index.yaml"),
      "utf8"
    );
    expect(subfolder).toContain("- 機能要件.yaml");
    const rootIndex = await readFile(path.join(root, "docs/_index.yaml"), "utf8");
    expect(rootIndex).toContain("- 02_要求・要件");
    expect(rootIndex).not.toContain("03_システム要件");

    const guide = await readFile(path.join(root, "docs/index.yaml"), "utf8");
    expect(guide).toMatch(/\[\[page-[a-f0-9]{24} \| 機能要件\]\]/);
    expect(guide).toContain("Template Pack");
  });

  it("adds only newly selected templates to an existing project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-add-"));
    const initial = await planProjectSetup(root, {
      mode: "templates",
      selectedTemplateIds: ["project-guide", "project-charter"],
      language: "ja"
    });
    await applyProjectSetup(initial);
    const configBefore = await readFile(path.join(root, "vellym.config.yaml"), "utf8");
    const guideBefore = await readFile(path.join(root, "docs/index.yaml"), "utf8");
    const added = await planProjectSetup(root, {
      operation: "add",
      mode: "templates",
      selectedTemplateIds: ["operations-guide"],
      contentRoot: "docs",
      language: "ja"
    });
    expect(added.files.some((file) => file.kind === "config")).toBe(false);
    expect(added.files.some((file) => file.relativePath === "docs/_index.yaml")).toBe(false);
    await applyProjectSetup(added);
    expect(await readFile(path.join(root, "vellym.config.yaml"), "utf8")).toBe(configBefore);
    expect(await readFile(path.join(root, "docs/index.yaml"), "utf8")).toBe(guideBefore);
    expect(await readFile(path.join(root, "docs/08_運用・保守/運用設計.yaml"), "utf8"))
      .toContain("title: 運用設計");
    const repeated = await planProjectSetup(root, {
      operation: "add",
      mode: "templates",
      selectedTemplateIds: ["operations-guide"],
      contentRoot: "docs",
      language: "ja"
    });
    expect(repeated.files).toContainEqual(
      expect.objectContaining({
        templateId: "operations-guide",
        status: "skip",
        conflictReason: "template-existing"
      })
    );
    expect(repeated.files.some((file) => file.status === "create")).toBe(false);
    await expect(
      planProjectSetup(root, {
        operation: "add",
        mode: "templates",
        selectedTemplateIds: ["test-plan"],
        contentRoot: "other-docs"
      })
    ).rejects.toMatchObject({ code: "SETUP_CONTENT_ROOT" });
  });

  it("starts from an empty selection and never auto-selects optional guides", async () => {
    const catalog = setupCatalog("ja");
    expect(catalog.packVersion).toBe("2.0.0");
    expect(
      catalog.pages.filter((page) => page.requiredness === "optional").map((page) => page.id)
    ).toEqual(
      expect.arrayContaining([
        "welcome",
        "external-ai-document-guide",
        "yaml-editing-guide"
      ])
    );

    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-default-"));
    const plan = await planProjectSetup(root);
    expect(plan.selectedTemplateIds).toEqual([]);
    expect(plan.selectedFolderIds).toEqual([]);
    expect(plan.files.every((file) => file.kind !== "page")).toBe(true);
  });

  it("creates selected guide Pages without a guide folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-guides-"));
    const plan = await planProjectSetup(root, {
      selectedTemplateIds: [
        "welcome",
        "project-guide",
        "external-ai-document-guide",
        "yaml-editing-guide"
      ]
    });
    await applyProjectSetup(plan);

    const repository = await loadRepository(path.join(root, "docs"));
    expect(repository.pages).toHaveLength(4);
    expect(
      repository.pages.map((page) => page.title)
    ).toEqual(
      expect.arrayContaining([
        "YAML直接編集ガイド",
        "プロジェクト文書の案内",
        "Vellymへようこそ",
        "外部AI向け文書利用ガイド"
      ])
    );
    await expect(access(path.join(root, "docs/guides"))).rejects.toThrow();
    const folder = await readFile(path.join(root, "docs/_index.yaml"), "utf8");
    expect(folder).toContain("- welcome.yaml");
    expect(folder).toContain("- index.yaml");
    expect(folder).toContain("- ai-guide.yaml");
    expect(folder).toContain("- yaml-guide.yaml");
    expect(
      await readFile(path.join(root, "docs/yaml-guide.yaml"), "utf8")
    ).toContain("apiVersion: vellym.tasclub.com/v1");
  });

  it("creates a valid empty root when every optional Page is deselected", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-empty-"));
    const plan = await planProjectSetup(root, { selectedTemplateIds: [] });
    await applyProjectSetup(plan);
    expect(await readFile(path.join(root, "docs/_index.yaml"), "utf8"))
      .toContain("order: []");
    const repository = await loadRepository(path.join(root, "docs"));
    expect(repository.pages).toHaveLength(0);
    expect(repository.diagnostics).toHaveLength(0);
  });

  it("localizes selected guide Pages and their filenames", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-guides-en-"));
    const plan = await planProjectSetup(root, {
      language: "en",
      selectedTemplateIds: [
        "project-guide",
        "external-ai-document-guide",
        "yaml-editing-guide"
      ]
    });
    await applyProjectSetup(plan);
    expect(
      await readFile(path.join(root, "docs/index.yaml"), "utf8")
    ).toContain("title: Project document guide");
    expect(
      await readFile(
        path.join(root, "docs/ai-guide.yaml"),
        "utf8"
      )
    ).toContain("It does not depend on a particular AI product");
    expect(
      await readFile(path.join(root, "docs/yaml-guide.yaml"), "utf8")
    ).toContain("Store one Page in each file");
  });

  it("uses validated GUI filename overrides for guide Pages", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-guide-name-"));
    const plan = await planProjectSetup(root, {
      selectedTemplateIds: ["project-guide", "yaml-editing-guide"],
      pageFileNames: {
        "project-guide": "start-here.yaml",
        "yaml-editing-guide": "format-help.yml"
      }
    });
    await applyProjectSetup(plan);
    expect(await readFile(path.join(root, "docs/start-here.yaml"), "utf8"))
      .toContain("プロジェクト文書の案内");
    expect(await readFile(path.join(root, "docs/format-help.yml"), "utf8"))
      .toContain("YAML直接編集ガイド");
  });

  it("rejects unsafe, reserved, and duplicate filenames for every Page", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-guide-bad-"));
    for (const fileName of [
      ".guide.yaml",
      "_index.yaml",
      "nested/guide.yaml",
      "guide.md"
    ]) {
      await expect(
        planProjectSetup(root, {
          selectedTemplateIds: ["project-guide"],
          pageFileNames: { "project-guide": fileName }
        })
      ).rejects.toMatchObject({ code: "SETUP_FILE_NAME" });
    }
    await expect(
      planProjectSetup(root, {
        selectedTemplateIds: ["project-guide", "yaml-editing-guide"],
        pageFileNames: {
          "project-guide": "guide.yaml",
          "yaml-editing-guide": "GUIDE.yaml"
        }
      })
    ).rejects.toMatchObject({ code: "SETUP_FILE_NAME" });
    const general = await planProjectSetup(root, {
      selectedTemplateIds: ["welcome"],
      pageFileNames: { welcome: "welcome.yaml" }
    });
    expect(general.files).toContainEqual(
      expect.objectContaining({ templateId: "welcome", relativePath: "docs/welcome.yaml" })
    );
  });

  it("plans without writing and applies the exact plan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-"));
    const plan = await planProjectSetup(root, { selectedTemplateIds: ["welcome"] });
    expect(plan.files.every((file) => file.status === "create")).toBe(true);
    await expect(access(path.join(root, "vellym.config.yaml"))).rejects.toThrow();
    await applyProjectSetup(plan);
    expect(await readFile(path.join(root, "vellym.config.yaml"), "utf8")).toContain(
      "contentRoot: docs"
    );
  });

  it("rejects changes made after preview without overwriting them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-conflict-"));
    const plan = await planProjectSetup(root);
    await writeFile(path.join(root, "vellym.config.yaml"), "external", "utf8");
    await expect(applyProjectSetup(plan)).rejects.toMatchObject({
      code: "SETUP_PLAN_CONFLICT"
    });
    expect(await readFile(path.join(root, "vellym.config.yaml"), "utf8")).toBe(
      "external"
    );
  });

  it("skips or renames existing template files without overwriting them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-existing-"));
    const existing = path.join(root, "docs/welcome.yaml");
    await mkdir(path.dirname(existing), { recursive: true });
    await writeFile(existing, "existing", "utf8");

    const skipped = await planProjectSetup(root, {
      selectedTemplateIds: ["welcome"],
      conflictResolutions: { welcome: "skip" }
    });
    expect(skipped.files).toContainEqual(
      expect.objectContaining({ templateId: "welcome", status: "skip" })
    );
    await applyProjectSetup(skipped);
    expect(await readFile(existing, "utf8")).toBe("existing");

    const alternateRoot = await mkdtemp(
      path.join(tmpdir(), "vellym-setup-alternate-")
    );
    const alternateExisting = path.join(
      alternateRoot,
      "docs/welcome.yaml"
    );
    await mkdir(path.dirname(alternateExisting), { recursive: true });
    await writeFile(alternateExisting, "existing", "utf8");
    const alternate = await planProjectSetup(alternateRoot, {
      selectedTemplateIds: ["welcome"],
      conflictResolutions: { welcome: "alternate" }
    });
    expect(alternate.files).toContainEqual(
      expect.objectContaining({
        relativePath: "docs/welcome-2.yaml",
        status: "create"
      })
    );
    await applyProjectSetup(alternate);
    expect(await readFile(alternateExisting, "utf8")).toBe("existing");
    expect(
      await readFile(
        path.join(alternateRoot, "docs/welcome-2.yaml"),
        "utf8"
      )
    ).toContain("Vellymへようこそ");
  });

  it("uses an opaque Page ID without conflicting with an existing semantic ID", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "vellym-setup-page-id-")
    );
    const existing = path.join(root, "docs/existing.yaml");
    await mkdir(path.dirname(existing), { recursive: true });
    await writeFile(
      existing,
      `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: welcome
  title: Existing welcome
spec:
  blocks: []
`,
      "utf8"
    );
    const planned = await planProjectSetup(root, {
      selectedTemplateIds: ["welcome"],
      conflictResolutions: { welcome: "alternate" }
    });
    expect(planned.files).toContainEqual(
      expect.objectContaining({
        templateId: "welcome",
        status: "create",
        pageId: expect.stringMatching(/^page-[a-f0-9]{24}$/)
      })
    );
    await applyProjectSetup(planned);
    expect(await readFile(existing, "utf8")).toContain("Existing welcome");
    expect(await readFile(path.join(root, "docs/welcome.yaml"), "utf8"))
      .toContain("name: page-");
  });
});

describe("slug migration", () => {
  it("previews and adds unique slugs without changing Page IDs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-slug-migration-"));
    await writeFile(
      path.join(root, "first.yaml"),
      source("first-page").replace("title: Before", "title: Same title"),
      "utf8"
    );
    await writeFile(
      path.join(root, "second.yaml"),
      source("second-page").replace("title: Before", "title: Same title"),
      "utf8"
    );
    const plan = await planSlugMigration(root);
    expect(plan.pages.map((page) => page.slug)).toEqual([
      "same-title",
      "same-title-2"
    ]);
    await applySlugMigration(root, plan);
    const repository = await loadRepository(root);
    expect(repository.byName.get("first-page")?.slug)
      .toBe("same-title");
    expect(repository.byName.get("second-page")?.slug)
      .toBe("same-title-2");
  });
});
