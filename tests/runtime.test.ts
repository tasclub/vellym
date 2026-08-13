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
  applySlugMigration,
  planSlugMigration,
  pageSummaries,
  applyProjectSetup,
  planProjectSetup,
  setupManifest,
  parsePagePatch,
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
    - type: vendor.example/widget
      payload:
        preserved: true
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
      baseHash: loaded.view.hash,
      title: "After",
      richTextBlocks: [{ id: "body", content: "After body" }]
    });
    const output = await readFile(loaded.sourcePath, "utf8");
    expect(output).toContain("# page comment");
    expect(output).toContain("vendorValue: keep-me");
    expect(output).toContain("vendor.example/widget");
    expect(output).toContain("preserved: true");
    expect(output).toContain("title: After");
    expect(output).toContain("After body");
  });

  it("does not overwrite an external change", async () => {
    const root = await fixture();
    const repository = await loadRepository(root);
    const loaded = repository.byName.get("test-page")!;
    await writeFile(loaded.sourcePath, source().replace("Before", "External"), "utf8");
    await expect(
      savePage(root, loaded, { baseHash: loaded.view.hash, title: "After" })
    ).rejects.toMatchObject({ status: 409, code: "HASH_CONFLICT" });
    expect(await readFile(loaded.sourcePath, "utf8")).toContain("External");
  });

  it("marks multi-document YAML read-only", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "nested/page.yaml"),
      `${source()}---\nanything: else\n`,
      "utf8"
    );
    const loaded = (await loadRepository(root)).byName.get("test-page")!;
    expect(loaded.view.readOnly).toBe(true);
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
    expect(searchRepository(repository, "Before").total).toBe(101);
    expect(repository.diagnostics).toHaveLength(0);
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
      const detail = await fetch(`${server.url}/api/v1/pages/test-page`);
      expect(detail.status).toBe(200);
      const search = await fetch(`${server.url}/api/v1/search?q=Before`);
      expect(search.status).toBe(200);
      expect(await search.json()).toMatchObject({
        data: {
          query: "Before",
          total: 1,
          results: [{ pageId: "test-page", title: "Before" }]
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
    await writeFile(path.join(ui, "index.html"), "<h1>UI</h1>", "utf8");
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
      const svg = await fetch(`${server.url}/icon.svg`);
      expect(svg.status).toBe(200);
      expect(svg.headers.get("content-type")).toBe("image/svg+xml");
      // 存在しないアセットをindex.htmlで代替すると失敗が200のHTMLとして隠れる。
      expect((await fetch(`${server.url}/missing.png`)).status).toBe(404);
      // 拡張子のない経路はSPAのentryへ委ねる。
      const route = await fetch(`${server.url}/settings`);
      expect(route.status).toBe(200);
      expect(route.headers.get("content-type")).toBe("text/html; charset=utf-8");
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
      const profiles = await fetch(
        `${server.url}/api/v1/setup/profiles`
      );
      expect(profiles.status).toBe(200);
      expect(await profiles.json()).toMatchObject({
        data: {
          profiles: expect.arrayContaining([
            expect.objectContaining({ id: "software-basic" })
          ])
        }
      });
      const input = {
        profiles: ["minimal"],
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
        data: { planHash: string; projectRoot?: string };
      };
      expect(previewBody.data.projectRoot).toBe(project);
      const applied = await fetch(`${server.url}/api/v1/setup/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          planHash: previewBody.data.planHash
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
        (await fetch(`${server.url}/api/v1/setup/profiles`)).status
      ).toBe(409);
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
  it("offers optional guides without expanding the default minimal setup", async () => {
    const manifest = setupManifest();
    const minimal = manifest.profiles.find((profile) => profile.id === "minimal")!;
    expect(minimal.templateIds).toEqual([
      "welcome",
      "project-guide",
      "external-ai-document-guide",
      "yaml-editing-guide"
    ]);
    expect(
      manifest.templates
        .filter((template) => minimal.templateIds.includes(template.id))
        .filter((template) => template.defaultSelected === false)
        .map((template) => template.id)
    ).toEqual([
      "project-guide",
      "external-ai-document-guide",
      "yaml-editing-guide"
    ]);

    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-default-"));
    const plan = await planProjectSetup(root);
    expect(plan.selectedTemplateIds).toEqual(["welcome"]);
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
      repository.pages.map((page) => page.view.page.metadata.title)
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
    expect(folder).toContain("- ようこそ.yaml");
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

  it("rejects unsafe, reserved, and duplicate guide filenames", async () => {
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
    await expect(
      planProjectSetup(root, {
        pageFileNames: { welcome: "welcome.yaml" }
      })
    ).rejects.toMatchObject({ code: "SETUP_FILE_NAME" });
  });

  it("plans without writing and applies the exact plan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-setup-"));
    const plan = await planProjectSetup(root);
    expect(plan.profiles).toEqual(["minimal"]);
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
    const existing = path.join(root, "docs/ようこそ.yaml");
    await mkdir(path.dirname(existing), { recursive: true });
    await writeFile(existing, "existing", "utf8");

    const skipped = await planProjectSetup(root, {
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
      "docs/ようこそ.yaml"
    );
    await mkdir(path.dirname(alternateExisting), { recursive: true });
    await writeFile(alternateExisting, "existing", "utf8");
    const alternate = await planProjectSetup(alternateRoot, {
      conflictResolutions: { welcome: "alternate" }
    });
    expect(alternate.files).toContainEqual(
      expect.objectContaining({
        relativePath: "docs/ようこそ-2.yaml",
        status: "create"
      })
    );
    await applyProjectSetup(alternate);
    expect(await readFile(alternateExisting, "utf8")).toBe("existing");
    expect(
      await readFile(
        path.join(alternateRoot, "docs/ようこそ-2.yaml"),
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
    expect(await readFile(path.join(root, "docs/ようこそ.yaml"), "utf8"))
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
    expect(repository.byName.get("first-page")?.view.page.metadata.slug)
      .toBe("same-title");
    expect(repository.byName.get("second-page")?.view.page.metadata.slug)
      .toBe("same-title-2");
  });
});
