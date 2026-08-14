import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_SCHEMA_VERSION,
  localeUrlSegment,
  publishedPageLocales,
  resolveDefaultLocale,
  type Diagnostic
} from "@vellym-internal/core";
import {
  localizedFolderSummaries,
  localizedPage,
  localizedPageSummaries,
  loadConfig,
  loadRepository
} from "@vellym-internal/runtime-node";
import { VELLYM_VERSION } from "./version.js";

// vellym-build.json（build来歴）の形式の版。
const BUILD_SCHEMA_VERSION = "1.0";

export interface StaticBuildResult {
  exitCode: number;
  data: { outputDir: string; pages: number } | null;
  diagnostics: Diagnostic[];
  message: string;
}

function envelope<T>(data: T, buildId: string, diagnostics: Diagnostic[] = []) {
  return { apiSchemaVersion: API_SCHEMA_VERSION, buildId, data, diagnostics };
}

// CLIバンドル(dist/cli.mjs)と同じ dist に同梱されるSPAクライアント束の場所。
function uiRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");
}

// 静的配信では、同じSPAがHTTP APIではなく焼き込みJSONを読む。その印をindex.htmlへ注入する。
function relativeBase(depth: number): string {
  return depth === 0 ? "./" : "../".repeat(depth);
}

function injectStaticMarker(html: string, options: {
  locale: string;
  defaultLocale: string;
  depth: number;
  buildId: string;
  canonical?: string;
  alternates?: Array<{ locale: string; href: string }>;
}): string {
  const base = relativeBase(options.depth);
  const marker = `<script>window.__VELLYM_STATIC__=${JSON.stringify({
    appBase: base,
    assetBase: `${base}assets`,
    dataBase: `${base}data/${options.buildId}/${localeUrlSegment(options.locale)}`,
    buildId: options.buildId,
    locale: options.locale,
    defaultLocale: options.defaultLocale
  }).replaceAll("<", "\\u003c")};</script>`;
  const links = [
    ...(options.canonical ? [`<link rel="canonical" href="${options.canonical}">`] : []),
    ...(options.alternates ?? []).map(({ locale, href }) =>
      `<link rel="alternate" hreflang="${locale}" href="${href}">`
    )
  ].join("");
  return html
    .replace(/<html lang="[^"]*"(?: dir="[^"]*")?>/, `<html lang="${options.locale}" dir="${direction(options.locale)}">`)
    .replaceAll('href="./assets/', `href="${base}assets/`)
    .replaceAll('src="./assets/', `src="${base}assets/`)
    .replace('href="./favicon.png"', `href="${base}favicon.png"`)
    .replace("</head>", `${links}${marker}</head>`);
}

function direction(locale: string): "ltr" | "rtl" {
  return ["ar", "fa", "he", "ur"].includes(locale.split("-")[0]!) ? "rtl" : "ltr";
}

function pageRoute(locale: string, defaultLocale: string, slug: string): string {
  return locale === defaultLocale
    ? `pages/${encodeURIComponent(slug)}/`
    : `${localeUrlSegment(locale)}/pages/${encodeURIComponent(slug)}/`;
}

function localeRoute(locale: string, defaultLocale: string): string {
  return locale === defaultLocale ? "" : `${localeUrlSegment(locale)}/`;
}

function publicUrl(base: string | undefined, route: string): string | undefined {
  return base ? new URL(route, base).href : undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// 毎回の生成を年月日日時で一意なフォルダへ分ける（例: 20260726-143002-vellym）。
function versionedFolderName(leaf: string, at: Date): string {
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${stamp}-${leaf}`;
}

function gitValue(projectRoot: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function readme(info: {
  builtAt: string;
  revision: string | null;
  dirty: boolean | null;
  pages: number;
  buildId: string;
  defaultLocale: string;
  locales: string[];
}): string {
  return `# Vellym 静的サイト

これは Vellym の閲覧専用SPA(単一ページアプリ)です。
編集・保存・構成管理・全文検索・設定は含まれません。

## 起動方法（HTTPで配信してください）

ブラウザで index.html を直接開く(file://)と、ブラウザのセキュリティ制約で
JS/CSS/データを読み込めず表示できません。次のいずれかで配信してください。

- Python: このフォルダで \`python3 -m http.server 8080\`
- Node:   このフォルダで \`npx serve .\`  （または \`npx http-server -p 8080\`）
- Nginx/Apache等: このフォルダをドキュメントルートに指定

配信後、ブラウザで http://localhost:8080/ を開きます。
相対パスで動くため、サーバーのサブディレクトリ配下に置いても動作します。

## 内容

- index.html : SPA本体
- assets/    : JS・CSS
- data/<build ID>/<locale>/ : 言語別データ (bootstrap.json / repository.json / pages/*.json)
- vellym-build.json : ビルド来歴

## ビルド情報

- 生成日時: ${info.builtAt}
- ソースリビジョン: ${info.revision ?? "-"}
- 未コミット変更(dirty): ${info.dirty === null ? "-" : info.dirty}
- ページ数: ${info.pages}
- ビルドID: ${info.buildId}
- 既定言語: ${info.defaultLocale}
- 公開言語: ${info.locales.join(", ")}
`;
}

export async function buildStatic(configPath: string): Promise<StaticBuildResult> {
  const loaded = await loadConfig(configPath);
  const repository = await loadRepository(loaded.contentRoot);
  const defaultLocale = resolveDefaultLocale(loaded.config);
  const discoveredLocales = [...new Set(repository.pages.flatMap((entry) => [
    ...(entry.configuredBaseLocale ? [entry.configuredBaseLocale] : []),
    ...(entry.availableLocales ?? [])
  ]))];
  const locales = [
    defaultLocale,
    ...discoveredLocales
      .filter((locale) => locale !== defaultLocale)
      .sort((left, right) => left.localeCompare(right))
  ];
  const errors = repository.diagnostics.filter((item) => item.severity === "error");
  if (errors.length) {
    return {
      exitCode: 1,
      data: null,
      diagnostics: repository.diagnostics,
      message: `静的生成を中止しました: ${errors.length}件のエラー`
    };
  }
  const builtAt = new Date();
  const revision = gitValue(loaded.projectRoot, ["rev-parse", "HEAD"]);
  const status = gitValue(loaded.projectRoot, ["status", "--porcelain"]);
  const dirty = status === null ? null : status !== "";
  const contentHash = createHash("sha256")
    .update(
      repository.pages
        .map((entry) => `${entry.relativePath}:${entry.hash}`)
        .sort()
        .join("\n")
    )
    .digest("hex");
  const buildId = createHash("sha256")
    .update(`${VELLYM_VERSION}:${contentHash}:${defaultLocale}`)
    .digest("hex")
    .slice(0, 16);

  const temporary = await mkdtemp(path.join(loaded.projectRoot, ".vellym-build-"));
  let target = "";
  try {
    // 1) 動的devと同一のSPAクライアント束をそのままコピーする。
    await cp(uiRoot(), temporary, { recursive: true });

    // 2) locale別dataと、root／locale／PageごとのSPA入口を生成する。
    const indexPath = path.join(temporary, "index.html");
    const sourceHtml = await readFile(indexPath, "utf8");

    const dataRoot = path.join(temporary, "data", buildId);
    for (const locale of locales) {
      const segment = localeUrlSegment(locale)!;
      const summaries = localizedPageSummaries(repository, locale, defaultLocale);
      const folders = localizedFolderSummaries(repository, locale, defaultLocale);
      const dataDir = path.join(dataRoot, segment);
      await mkdir(path.join(dataDir, "pages"), { recursive: true });
      await writeFile(path.join(dataDir, "bootstrap.json"), `${JSON.stringify(envelope({
          state: "ready",
          project: {
            projectRoot: loaded.projectRoot,
            contentRoot: loaded.config.contentRoot,
            resolvedContentRoot: loaded.contentRoot,
            language: loaded.config.ui.language,
            defaultLocale,
            requestedLocale: locale,
            resolvedLocale: locale,
            uiLocale: locale === "ja" || locale === "en" ? locale : loaded.config.ui.language,
            availableLocales: locales,
            configPath:
              path.relative(loaded.projectRoot, loaded.configPath) ||
              "vellym.config.yaml"
          },
          capabilities: {
            repository: true,
            editing: false,
            search: false,
            structure: false,
            setup: false,
            live: false
          }
        }, buildId))}\n`, "utf8");
      await writeFile(path.join(dataDir, "repository.json"), `${JSON.stringify(
        envelope({ locale, defaultLocale, availableLocales: locales, pages: summaries, folders }, buildId, repository.diagnostics)
      )}\n`, "utf8");

      for (const summary of summaries) {
        const projected = await localizedPage(repository, summary.name, locale, defaultLocale);
        if (!projected || "state" in projected) continue;
        await writeFile(
          path.join(dataDir, "pages", `${summary.name}.json`),
          `${JSON.stringify(envelope(projected, buildId))}\n`,
          "utf8"
        );
        const route = pageRoute(locale, defaultLocale, summary.slug ?? summary.name);
        const publishedLocales = (projected.availableLocales ?? [defaultLocale]);
        const canonical = publicUrl(loaded.config.static?.publicBaseUrl, route);
        const alternates = loaded.config.static?.publicBaseUrl
          ? publishedLocales.map((item) => ({
              locale: item,
              href: publicUrl(
                loaded.config.static!.publicBaseUrl,
                pageRoute(item, defaultLocale, summary.slug ?? summary.name)
              )!
            }))
          : undefined;
        const pageIndex = path.join(temporary, route, "index.html");
        await mkdir(path.dirname(pageIndex), { recursive: true });
        await writeFile(pageIndex, injectStaticMarker(sourceHtml, {
          locale,
          defaultLocale,
          depth: locale === defaultLocale ? 2 : 3,
          buildId,
          ...(canonical ? { canonical } : {}),
          ...(alternates ? { alternates } : {})
        }), "utf8");
      }

      const route = localeRoute(locale, defaultLocale);
      const localeIndex = path.join(temporary, route, "index.html");
      await mkdir(path.dirname(localeIndex), { recursive: true });
      await writeFile(localeIndex, injectStaticMarker(sourceHtml, {
        locale,
        defaultLocale,
        depth: locale === defaultLocale ? 0 : 1,
        buildId,
        ...(publicUrl(loaded.config.static?.publicBaseUrl, route)
          ? { canonical: publicUrl(loaded.config.static?.publicBaseUrl, route)! }
          : {})
      }), "utf8");
    }

    // 3) 来歴とREADMEを出力する。
    await writeFile(
      path.join(temporary, "vellym-build.json"),
      `${JSON.stringify({
        buildSchemaVersion: BUILD_SCHEMA_VERSION,
        generatorVersion: VELLYM_VERSION,
        sourceRevision: revision || null,
        dirty,
        contentHash,
        buildId,
        defaultLocale,
        locales
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      path.join(temporary, "README.md"),
      readme({
        builtAt: builtAt.toISOString(),
        revision: revision || null,
        dirty,
        pages: repository.pages.length,
        buildId,
        defaultLocale,
        locales
      }),
      "utf8"
    );

    // 4) outputDirの親に、年月日日時で一意なバージョンフォルダとして配置する。
    const parent = path.dirname(loaded.outputDir);
    const leaf = path.basename(loaded.outputDir);
    await mkdir(parent, { recursive: true });
    target = path.join(parent, versionedFolderName(leaf, builtAt));
    while (await exists(target)) {
      target = path.join(
        parent,
        `${versionedFolderName(leaf, builtAt)}-${randomBytes(2).toString("hex")}`
      );
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return {
    exitCode: 0,
    data: { outputDir: target, pages: repository.pages.length },
    diagnostics: repository.diagnostics,
    message: `静的サイトを生成しました: ${repository.pages.length}ページ -> ${target}`
  };
}
