import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const cli = path.resolve("packages/vellym/dist/cli.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8"
  });
}

function initArgs(root: string, extra: string[] = []): string[] {
  return [
    "init",
    root,
    "--size",
    "small-team",
    "--method",
    "hybrid",
    "--language",
    "ja",
    "--content-root",
    "docs",
    ...extra
  ];
}

async function directoryHash(directory: string): Promise<string> {
  const values: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else values.push(`${path.relative(directory, target)}:${await readFile(target, "utf8")}`);
    }
  }
  await visit(directory);
  return createHash("sha256").update(values.join("\n")).digest("hex");
}

// 静的ビルドは年月日日時の一意フォルダへ出力する。--jsonで実際の出力先を得る。
function buildDir(config: string): string {
  const result = run(["build", "--config", config, "--json"]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout).data.outputDir as string;
}

async function staticDataDir(output: string, locale?: string): Promise<string> {
  const build = JSON.parse(await readFile(path.join(output, "vellym-build.json"), "utf8"));
  return path.join(output, "data", build.buildId, (locale ?? build.defaultLocale).toLowerCase());
}

describe("published CLI shape", () => {
  it("builds an executable CLI entry point", async () => {
    expect((await stat(cli)).mode & 0o111).not.toBe(0);
  });

  it("reports the package version from the build", async () => {
    const manifest = JSON.parse(
      await readFile(path.resolve("packages/vellym/package.json"), "utf8")
    );
    expect(run(["--version"]).stdout.trim()).toBe(manifest.version);
  });

  it("creates the strict recommended structure in Japanese and English", async () => {
    for (const language of ["ja", "en"] as const) {
      const root = await mkdtemp(path.join(tmpdir(), `vellym-product-${language}-`));
      const result = run([
        "init", root, "--size", "small-team", "--method", "agile",
        "--language", language, "--content-root", "docs"
      ]);
      expect(result.status).toBe(0);
      const repository = run([
        "validate", "--config", path.join(root, "vellym.config.yaml"), "--json"
      ]);
      expect(repository.status).toBe(0);
      expect(JSON.parse(repository.stdout).data.pages.length).toBeGreaterThan(20);
      const charter = await readFile(
        path.join(
          root,
          "docs",
          language === "ja"
            ? "00_プロジェクト概要/プロジェクト憲章.yaml"
            : "00_project-overview/project-charter.yaml"
        ),
        "utf8"
      );
      expect(charter).toContain(
        language === "ja" ? "## このPageの目的" : "## Purpose of this page"
      );
      // The strict CLI run produces the same multi-level hierarchy as the browser.
      const nested = await readFile(
        path.join(
          root,
          "docs",
          language === "ja"
            ? "03_アーキテクチャ/01_arc42/_index.yaml"
            : "03_architecture/01_arc42/_index.yaml"
        ),
        "utf8"
      );
      // 生成物へprovenance annotationsは書かない。構造そのものを検証する。
      expect(nested).toContain("kind: Folder");
      expect(nested).not.toContain("annotations:");
    }
  });

  it("previews and applies an explicit v1 migration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-migrate-"));
    expect(run(initArgs(root)).status).toBe(0);
    const config = path.join(root, "vellym.config.yaml");
    // initはv1で生成するため、alpha時代のprojectをv1alpha1へ戻して再現する。
    const welcome = path.join(root, "docs/index.yaml");
    await writeFile(
      welcome,
      (await readFile(welcome, "utf8")).replace(
        "apiVersion: vellym.tasclub.com/v1\n",
        "apiVersion: vellym.tasclub.com/v1alpha1\n"
      ),
      "utf8"
    );
    const preview = run(["migrate", "--to", "v1", "--config", config, "--plan", "--json"]);
    expect(preview.status).toBe(0);
    expect(JSON.parse(preview.stdout).data.files.length).toBeGreaterThan(0);
    expect(run(["migrate", "--to", "v1", "--config", config]).status).toBe(0);
    expect(await readFile(welcome, "utf8"))
      .toContain("apiVersion: vellym.tasclub.com/v1\n");
  });

  it("bakes plugin views and assets into the static output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-plugin-"));
    expect(run(initArgs(root)).status).toBe(0);
    const config = path.join(root, "vellym.config.yaml");
    // 同じリポジトリのworkspaceを解決させる。第三者と同じ経路（package名）で読む。
    // 生成された設定には`plugins: []`が既にある。足すのではなく差し替える。
    const baseConfig = await readFile(config, "utf8");
    expect(baseConfig).toContain("plugins: []");
    await writeFile(
      config,
      baseConfig.replace("plugins: []", 'plugins:\n  - "@vellym/tickets"'),
      "utf8"
    );
    await mkdir(path.join(root, "node_modules/@vellym"), { recursive: true });
    await symlink(
      path.join(process.cwd(), "packages/plugin-tickets"),
      path.join(root, "node_modules/@vellym/tickets"),
      "dir"
    );
    await symlink(
      path.join(process.cwd(), "packages/plugin-api"),
      path.join(root, "node_modules/@vellym/plugin-api"),
      "dir"
    );
    await writeFile(
      path.join(root, "docs/tracker.yaml"),
      `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata:
  name: build-tracker
  title: 作業
spec:
  statuses:
    - id: todo
      label: 未着手
      category: open
  fields: []
`,
      "utf8"
    );
    await mkdir(path.join(root, "docs/+tickets"), { recursive: true });
    await writeFile(
      path.join(root, "docs/+tickets/ticket-static-detail.yaml"),
      `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata:
  name: ticket-static-detail
  title: 静的版で開くチケット
spec:
  status: todo
  fields: {}
  blocks:
    - id: description
      type: rich-text
      content: 静的詳細
`,
      "utf8"
    );

    const output = buildDir(config);
    const dataDir = await staticDataDir(output);

    // **プラグインのビューが焼き込まれている。** devと同じ関数を通した結果である。
    const view = JSON.parse(
      await readFile(path.join(dataDir, "views/build-tracker.json"), "utf8")
    );
    expect(view.data.pluginId).toBe("tickets");
    expect(view.data.descriptor).toBeDefined();
    // static:falseの設定ビューは切替導線へ残さない。
    expect(view.data.siblings.map((item: { id: string }) => item.id)).toEqual([
      "ticket-list"
    ]);

    // 文書ツリーへ出ないTicketも、static:trueの詳細ビューを持つため焼かれる。
    expect(existsSync(path.join(dataDir, "pages/ticket-static-detail.json"))).toBe(true);
    expect(existsSync(path.join(dataDir, "views/ticket-static-detail.json"))).toBe(true);
    expect(
      existsSync(path.join(output, "pages/ticket-static-detail/index.html"))
    ).toBe(true);
    const ticketView = JSON.parse(
      await readFile(path.join(dataDir, "views/ticket-static-detail.json"), "utf8")
    );
    expect(ticketView.data.viewId).toBe("ticket-detail");
    const repository = JSON.parse(
      await readFile(path.join(dataDir, "repository.json"), "utf8")
    );
    expect(repository.data.pages.map((item: { name: string }) => item.name))
      .not.toContain("ticket-static-detail");

    // ブラウザ側資産が出力へ含まれている。**外部URLを参照しない。**
    expect(existsSync(path.join(output, "plugins/tickets/index.js"))).toBe(true);
    // Node側の出力と型定義を混ぜない。専用ディレクトリだけを配る。
    expect(existsSync(path.join(output, "plugins/tickets/node.js"))).toBe(false);

    const bootstrap = JSON.parse(
      await readFile(path.join(dataDir, "bootstrap.json"), "utf8")
    );
    expect(bootstrap.data.plugins.browserEntries).toEqual([
      { id: "tickets", url: "plugins/tickets/index.js" }
    ]);
    expect(bootstrap.data.plugins.kindIcons.TicketTracker).toBeDefined();

    // 深いページのimport mapが、その深さへ直っていること。相対のままだと
    // `pages/<slug>/assets/...`へ解決され、Reactの読み込みだけが404になる。
    const pageHtml = await readFile(
      path.join(output, "pages/build-tracker/index.html"),
      "utf8"
    );
    expect(pageHtml).toContain('"react":"../../assets/vellym-react.js"');
    const rootHtml = await readFile(path.join(output, "index.html"), "utf8");
    expect(rootHtml).toContain('"react":"./assets/vellym-react.js"');
  });

  it("initializes, validates, and builds a minimal project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-"));
    expect(run(initArgs(root)).status).toBe(0);
    await mkdir(path.join(root, "docs/.guides"), { recursive: true });
    await writeFile(
      path.join(root, "docs/.guides/hidden.yaml"),
      `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: hidden
  title: Hidden
spec:
  blocks: []
`,
      "utf8"
    );
    const config = path.join(root, "vellym.config.yaml");
    expect(run(["validate", "--config", config]).status).toBe(0);
    const output = buildDir(config);
    expect(path.basename(output)).toMatch(/^\d{8}-\d{6}-vellym$/);
    expect(await readFile(path.join(output, "README.md"), "utf8")).toContain(
      "python3 -m http.server"
    );
    const index = await readFile(path.join(output, "index.html"), "utf8");
    expect(index).toContain("Vellym");
    expect(index).toContain("__VELLYM_STATIC__");
    const dataDir = await staticDataDir(output);
    const bootstrap = JSON.parse(await readFile(path.join(dataDir, "bootstrap.json"), "utf8"));
    expect(bootstrap.data.state).toBe("ready");
    expect(bootstrap.data.capabilities.editing).toBe(false);
    expect(bootstrap.data.capabilities.live).toBe(false);
    const repository = JSON.parse(
      await readFile(path.join(dataDir, "repository.json"), "utf8")
    );
    const names = repository.data.pages.map((page: { name: string }) => page.name);
    expect(names).not.toContain("hidden");
    for (const name of names) {
      const page = JSON.parse(
        await readFile(path.join(dataDir, `pages/${name}.json`), "utf8")
      );
      expect(page.data.page.metadata.name).toBe(name);
    }
    await expect(
      access(path.join(dataDir, "pages/hidden.json"))
    ).rejects.toThrow();
  });

  it("does not overwrite an existing project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-existing-"));
    expect(run(initArgs(root)).status).toBe(0);
    expect(run(initArgs(root)).status).toBe(1);
  });

  it("rejects removed interactive init options", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-plan-"));
    const result = run(initArgs(root, ["--plan", "--json"]));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--plan");
    await expect(access(path.join(root, "vellym.config.yaml"))).rejects.toThrow();
  });

  it("rejects template selection because CLI uses one strict generation path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-guides-"));
    const result = run(initArgs(root, [
      "--template",
      "welcome,project-guide,yaml-editing-guide"
    ]));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--template");
  });

  it("rejects removed profile selection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-profiles-"));
    const preview = run(initArgs(root, [
      "--profile",
      "software-basic,arc42",
      "--plan",
      "--json"
    ]));
    expect(preview.status).toBe(2);
    expect(preview.stderr).toContain("--profile");
  });

  it("skips conflicting Page files and preserves user content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-safe-existing-"));
    const existing = path.join(root, "docs/02_要求・要件/要求.yaml");
    await mkdir(path.dirname(existing), { recursive: true });
    await writeFile(existing, "利用者が作成した既存内容\n", "utf8");
    await writeFile(path.join(root, "unrelated.txt"), "keep\n", "utf8");

    const result = run(initArgs(root));

    expect(result.status).toBe(0);
    expect(await readFile(existing, "utf8")).toBe("利用者が作成した既存内容\n");
    expect(await readFile(path.join(root, "unrelated.txt"), "utf8")).toBe("keep\n");
    expect(await readFile(path.join(root, "vellym.config.yaml"), "utf8")).toContain("contentRoot: docs");
    expect(result.stdout).toContain("skip:");
  });

  it("emits JSON-only validation output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-json-"));
    run(initArgs(root));
    const result = run([
      "validate",
      "--config",
      path.join(root, "vellym.config.yaml"),
      "--json"
    ]);
    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("creates deterministic baked data for unchanged input", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-deterministic-"));
    run(initArgs(root));
    const config = path.join(root, "vellym.config.yaml");
    // フォルダ名やREADMEの生成日時は都度変わるため、焼き込みデータの再現性を検証する。
    const first = await directoryHash(path.join(buildDir(config), "data"));
    const second = await directoryHash(path.join(buildDir(config), "data"));
    expect(second).toBe(first);
  });

  it("sets the static document language from the project config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-static-language-"));
    expect(run([
      "init", root, "--size", "personal", "--method", "agile",
      "--language", "en", "--content-root", "docs"
    ]).status).toBe(0);
    const output = buildDir(path.join(root, "vellym.config.yaml"));
    const index = await readFile(path.join(output, "index.html"), "utf8");
    expect(index).toContain('<html lang="en" dir="ltr">');
  });

  it("bakes read-only data for every page and marks the static SPA", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-navigation-"));
    expect(run(initArgs(root)).status).toBe(0);
    await writeFile(
      path.join(root, "docs/second.yaml"),
      `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: second
  title: 二番目
spec:
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: |
        ## 見出し

        本文
`,
      "utf8"
    );
    const config = path.join(root, "vellym.config.yaml");
    const output = buildDir(config);
    const index = await readFile(path.join(output, "index.html"), "utf8");
    expect(index).toContain("__VELLYM_STATIC__");
    const repository = JSON.parse(
      await readFile(path.join(await staticDataDir(output), "repository.json"), "utf8")
    );
    const pages = repository.data.pages as Array<{ name: string; title: string }>;
    expect(pages.map((page) => page.title)).toContain("二番目");
    for (const page of pages) {
      const detail = JSON.parse(
        await readFile(path.join(await staticDataDir(output), `pages/${page.name}.json`), "utf8")
      );
      expect(detail.data.page.metadata.name).toBe(page.name);
    }
    const second = pages.find((page) => page.title === "二番目")!;
    const secondDetail = JSON.parse(
      await readFile(path.join(await staticDataDir(output), `pages/${second.name}.json`), "utf8")
    );
    expect(JSON.stringify(secondDetail.data)).toContain("見出し");
    expect(await readFile(
      path.join(output, "pages", second.name, "index.html"),
      "utf8"
    )).toContain("__VELLYM_STATIC__");
  });

  it("builds only published locale projections with deep portable entry points", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-static-i18n-"));
    const content = path.join(root, "docs");
    await mkdir(content, { recursive: true });
    await writeFile(path.join(root, "vellym.config.yaml"), `schemaVersion: "1.0"
contentRoot: docs
outputDir: dist/vellym
ui:
  language: ja
i18n:
  defaultLocale: ja
static:
  publicBaseUrl: https://docs.example.com/product/
plugins: []
`, "utf8");
    await writeFile(path.join(content, "guide.yaml"), `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: guide
  title: ガイド
  slug: getting-started
spec:
  locale: ja
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: 日本語本文
  translations:
    en:
      title: Guide
      blocks:
        - id: body
          type: rich-text
          format: commonmark
          content: English body
    fr:
      visibility: draft
      title: Brouillon
      blocks: []
`, "utf8");
    await writeFile(path.join(content, "ja-only.yaml"), `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: ja-only
  title: 日本語のみ
spec:
  locale: ja
  blocks: []
`, "utf8");

    const output = buildDir(path.join(root, "vellym.config.yaml"));
    const build = JSON.parse(await readFile(path.join(output, "vellym-build.json"), "utf8"));
    expect(build.locales).toEqual(["ja", "en"]);
    await expect(access(path.join(output, "fr"))).rejects.toThrow();

    const enData = await staticDataDir(output, "en");
    const enRepository = JSON.parse(await readFile(path.join(enData, "repository.json"), "utf8"));
    expect(enRepository.buildId).toBe(build.buildId);
    expect(enRepository.data.pages).toEqual([
      expect.objectContaining({ name: "guide", slug: "getting-started", title: "Guide" }),
      expect.objectContaining({ name: "ja-only", title: "日本語のみ", locale: "ja" })
    ]);
    expect(JSON.parse(await readFile(path.join(enData, "pages/ja-only.json"), "utf8")))
      .toMatchObject({ data: { locale: "ja", requestedLocale: "en" } });

    const defaultPage = await readFile(
      path.join(output, "pages/getting-started/index.html"),
      "utf8"
    );
    const englishPage = await readFile(
      path.join(output, "en/pages/getting-started/index.html"),
      "utf8"
    );
    expect(defaultPage).toContain('lang="ja" dir="ltr"');
    expect(defaultPage).toContain('src="../../assets/');
    expect(englishPage).toContain('lang="en" dir="ltr"');
    expect(englishPage).toContain('src="../../../assets/');
    expect(englishPage).toContain(`"buildId":"${build.buildId}"`);
    expect(englishPage).toContain('rel="canonical" href="https://docs.example.com/product/en/pages/getting-started/"');
    expect(englishPage).toContain('hreflang="ja" href="https://docs.example.com/product/pages/getting-started/"');
    expect(englishPage).toContain('hreflang="en" href="https://docs.example.com/product/en/pages/getting-started/"');
    expect(await readFile(path.join(output, "en/pages/ja-only/index.html"), "utf8"))
      .toContain("__VELLYM_STATIC__");
  });

  it("leaves existing versions untouched when validation fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-cli-preserve-output-"));
    run(initArgs(root));
    const config = path.join(root, "vellym.config.yaml");
    const output = buildDir(config);
    const first = await directoryHash(output);
    await writeFile(
      path.join(root, "docs/broken.yaml"),
      "apiVersion: vellym.tasclub.com/v1alpha1\nkind: Page\nmetadata: {}\nspec: {}\n",
      "utf8"
    );
    expect(run(["build", "--config", config]).status).toBe(1);
    // 失敗ビルドは既存のバージョンフォルダを変更せず、新しいフォルダも作らない。
    expect(await directoryHash(output)).toBe(first);
    const versions = (await readdir(path.join(root, "dist"))).filter((name) =>
      name.endsWith("-vellym")
    );
    expect(versions).toEqual([path.basename(output)]);
  });

  it("rejects an unsupported listen address", () => {
    const result = run(["dev", "--host", "example.com"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--hostは127.0.0.1または0.0.0.0");
  });

  it("localizes CLI output when --language en is passed (RELUX-10)", () => {
    const result = run(["dev", "--host", "example.com", "--language", "en"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--host must be 127.0.0.1 or 0.0.0.0");
  });
});
