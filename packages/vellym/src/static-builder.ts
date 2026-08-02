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
import type { Diagnostic } from "@vellym-internal/core";
import {
  loadConfig,
  loadRepository,
  pageSummaries
} from "@vellym-internal/runtime-node";
import { VELLYM_VERSION } from "./version.js";

const SCHEMA_VERSION = "1.0";

export interface StaticBuildResult {
  exitCode: number;
  data: { outputDir: string; pages: number } | null;
  diagnostics: Diagnostic[];
  message: string;
}

function envelope<T>(data: T, diagnostics: Diagnostic[] = []) {
  return { schemaVersion: SCHEMA_VERSION, data, diagnostics };
}

// CLIバンドル(dist/cli.mjs)と同じ dist に同梱されるSPAクライアント束の場所。
function uiRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");
}

// 静的配信では、同じSPAがHTTP APIではなく焼き込みJSONを読む。その印をindex.htmlへ注入する。
function injectStaticMarker(html: string, language: "ja" | "en"): string {
  const marker = `<script>window.__VELLYM_STATIC__={dataBase:"./data"};</script>`;
  const localized = html.replace(/<html lang="[^"]*">/, `<html lang="${language}">`);
  return localized.includes("</head>")
    ? localized.replace("</head>", `${marker}</head>`)
    : `${marker}${localized}`;
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
- data/      : 焼き込みデータ (bootstrap.json / repository.json / pages/*.json)
- vellym-build.json : ビルド来歴

## ビルド情報

- 生成日時: ${info.builtAt}
- ソースリビジョン: ${info.revision ?? "-"}
- 未コミット変更(dirty): ${info.dirty === null ? "-" : info.dirty}
- ページ数: ${info.pages}
`;
}

export async function buildStatic(configPath: string): Promise<StaticBuildResult> {
  const loaded = await loadConfig(configPath);
  const repository = await loadRepository(loaded.contentRoot);
  const summaries = pageSummaries(repository);
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

  const temporary = await mkdtemp(path.join(loaded.projectRoot, ".vellym-build-"));
  let target = "";
  try {
    // 1) 動的devと同一のSPAクライアント束をそのままコピーする。
    await cp(uiRoot(), temporary, { recursive: true });

    // 2) 静的モードの印をindex.htmlへ注入する。
    const indexPath = path.join(temporary, "index.html");
    await writeFile(
      indexPath,
      injectStaticMarker(
        await readFile(indexPath, "utf8"),
        loaded.config.ui.language
      ),
      "utf8"
    );

    // 3) HTTP APIの代替となる焼き込みデータ(閲覧専用capabilities)を出力する。
    const dataDir = path.join(temporary, "data");
    await mkdir(path.join(dataDir, "pages"), { recursive: true });
    await writeFile(
      path.join(dataDir, "bootstrap.json"),
      `${JSON.stringify(
        envelope({
          state: "ready",
          project: {
            projectRoot: loaded.projectRoot,
            contentRoot: loaded.config.contentRoot,
            resolvedContentRoot: loaded.contentRoot,
            language: loaded.config.ui.language,
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
        })
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(dataDir, "repository.json"),
      `${JSON.stringify(
        envelope(
          { pages: summaries, folders: repository.folders },
          repository.diagnostics
        )
      )}\n`,
      "utf8"
    );
    for (const loadedPage of repository.pages) {
      await writeFile(
        path.join(dataDir, "pages", `${loadedPage.view.page.metadata.name}.json`),
        `${JSON.stringify(envelope(loadedPage.view))}\n`,
        "utf8"
      );
    }

    // 4) 来歴とREADMEを出力する。
    const contentHash = createHash("sha256")
      .update(
        repository.pages
          .map(({ view }) => `${view.relativePath}:${view.hash}`)
          .sort()
          .join("\n")
      )
      .digest("hex");
    await writeFile(
      path.join(temporary, "vellym-build.json"),
      `${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        generatorVersion: VELLYM_VERSION,
        sourceRevision: revision || null,
        dirty,
        contentHash
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      path.join(temporary, "README.md"),
      readme({
        builtAt: builtAt.toISOString(),
        revision: revision || null,
        dirty,
        pages: repository.pages.length
      }),
      "utf8"
    );

    // 5) outputDirの親に、年月日日時で一意なバージョンフォルダとして配置する。
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
