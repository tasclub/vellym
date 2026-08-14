import { access, readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import {
  normalizeLocale,
  projectLocales,
  resolveDefaultLocale,
  type Diagnostic
} from "@vellym-internal/core";
import {
  applyContentRootChange,
  applyUiLanguage,
  loadConfig,
  planContentRootChange,
  type ContentRootPlan
} from "./config.js";
import { RuntimeError } from "./errors.js";
import { parseFolderPatch, saveFolder } from "./folder-store.js";
import { parsePagePatch, savePage } from "./page-store.js";
import { isInside } from "./path-utils.js";
import {
  editablePage,
  editableFolder,
  loadRepository,
  localizedFolderSummaries,
  localizedPage,
  localizedPageSummaries,
  localizedSearchRepository,
  pageSummaries
} from "./repository.js";
import {
  applyProjectSetup,
  planProjectSetup,
  setupManifest,
  type SetupPlan,
  type SetupProfileId,
  type SetupLanguage
} from "./setup.js";
import {
  applySlugMigration,
  planSlugMigration,
  type SlugMigrationPlan
} from "./slug-migration.js";
import {
  applyStructureUndo,
  applyStructureChange,
  listArchived,
  planStructureChange,
  type StructurePlan,
  type StructureUndoPlan
} from "./structure.js";
import type { LoadedConfig, RepositorySnapshot } from "./types.js";

// 応答すべてに付ける防御的なheader。
// nosniffはContent-Typeを厳密化した意味を保つために必須で、
// これがないとbrowserが中身を推測して別種のresourceとして解釈しうる。
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer"
} as const;

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(value));
}

function envelope(data: unknown, diagnostics: Diagnostic[] = []): unknown {
  return { schemaVersion: "1.0", data, diagnostics };
}

function localeRequest(
  url: URL,
  config: Pick<LoadedConfig["config"], "ui" | "i18n">
): { defaultLocale: string; requestedLocale: string; uiLocale: string } {
  const defaultLocale = resolveDefaultLocale(config);
  const raw = url.searchParams.get("locale") ?? defaultLocale;
  const normalized = normalizeLocale(raw);
  if (!normalized.valid) {
    throw new RuntimeError(
      `locale「${raw}」はVellymで利用できる形式ではありません`,
      400,
      "INVALID_LOCALE"
    );
  }
  const requestedLocale = normalized.canonical!;
  const uiLocale = requestedLocale === "ja" || requestedLocale === "en"
    ? requestedLocale
    : config.ui.language;
  return { defaultLocale, requestedLocale, uiLocale };
}

function availableProjectLocales(
  snapshot: RepositorySnapshot,
  defaultLocale: string
): string[] {
  return [...new Set([
    ...projectLocales(
      [],
      [...snapshot.folderResources.values()].map(({ resource }) => resource),
      defaultLocale
    ),
    ...snapshot.pages.flatMap((entry) => [
      ...(entry.configuredBaseLocale ? [entry.configuredBaseLocale] : []),
      ...(entry.availableLocales ?? [])
    ])
  ])];
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) {
      throw new RuntimeError(
        "リクエストが大きすぎます",
        413,
        "BODY_LIMIT"
      );
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RuntimeError(
      "JSONを解析できません",
      400,
      "INVALID_JSON"
    );
  }
}

// UI bundleが実際に含みうる拡張子だけを持つ。未知の拡張子は
// text/htmlとして解釈させず、ダウンロード扱いになる既定値へ落とす。
const CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"]
]);

function contentTypeFor(extension: string): string {
  return CONTENT_TYPES.get(extension) ?? "application/octet-stream";
}

// Viteのbundleは静的サイトのsubdirectory配信に備えて相対asset URLを持つ。
// dev serverのSPA fallbackでそのまま返すと、深いlocale URLでは
// /en/pages/<slug>/assets/... と解決されるため、動的版だけ配信rootへ固定する。
function dynamicIndexHtml(body: Buffer): Buffer {
  return Buffer.from(
    body.toString("utf8")
      .replaceAll('href="./assets/', 'href="/assets/')
      .replaceAll('src="./assets/', 'src="/assets/')
      .replace('href="./favicon.png"', 'href="/favicon.png"'),
    "utf8"
  );
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

// Hostヘッダのhost部分だけを取り出す。"127.0.0.1:4173"→"127.0.0.1"、
// "[::1]:4173"→"[::1]"。portは許可判定に使わない。
function hostName(header: string | undefined): string {
  const value = (header ?? "").trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end < 0 ? value : value.slice(0, end + 1);
  }
  const separator = value.indexOf(":");
  return separator < 0 ? value : value.slice(0, separator);
}

// loopbackへbindしている間は、DNS rebindingで外部サイトから
// ローカルのAPIへ到達されないようHostを限定する。
// 利用者が明示的に外部bindを選んだ場合は到達に使うhost名を決められないため、
// 起動時の警告へ委ねて許可する。
function assertAllowedHost(
  header: string | undefined,
  allowed: ReadonlySet<string>
): void {
  if (!allowed.size) return;
  if (allowed.has(hostName(header))) return;
  throw new RuntimeError(
    "許可されていないHostです",
    403,
    "HOST"
  );
}

function assertAllowedOrigin(
  method: string | undefined,
  origin: string | undefined,
  host: string | undefined
): void {
  if (method === "GET" || !origin) return;
  try {
    if (host && new URL(origin).host === host) return;
  } catch {
    // 不正なOriginは下で拒否する。
  }
  throw new RuntimeError(
    "許可されていないOriginです",
    403,
    "ORIGIN"
  );
}

function reloadFailureSnapshot(
  current: RepositorySnapshot,
  error: unknown
): RepositorySnapshot {
  return {
    ...current,
    diagnostics: [
      ...current.diagnostics.filter(
        (item) => item.code !== "REPOSITORY_RELOAD"
      ),
      {
        file: ".",
        severity: "error",
        code: "REPOSITORY_RELOAD",
        message: error instanceof Error ? error.message : String(error)
      }
    ]
  };
}

const profileIds = new Set<SetupProfileId>([
  "minimal",
  "software-basic",
  "arc42",
  "project-management",
  "product-planning"
]);

interface SetupHttpInput {
  profiles: SetupProfileId[];
  selectedTemplateIds?: string[];
  conflictResolutions: Record<string, "skip" | "alternate">;
  contentRoot: string;
  language: SetupLanguage;
  folderNames: Record<string, string>;
  pageFileNames: Record<string, string>;
}

function setupInput(value: unknown): SetupHttpInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError(
      "セットアップ入力が不正です",
      400,
      "SETUP_INPUT"
    );
  }
  const input = value as Record<string, unknown>;
  const profiles = input.profiles ?? ["software-basic"];
  if (
    !Array.isArray(profiles) ||
    !profiles.length ||
    profiles.some(
      (item) => typeof item !== "string" || !profileIds.has(item as SetupProfileId)
    )
  ) {
    throw new RuntimeError(
      "profileが不正です",
      400,
      "SETUP_PROFILE"
    );
  }
  const selectedTemplateIds = input.selectedTemplateIds;
  if (
    selectedTemplateIds !== undefined &&
    (!Array.isArray(selectedTemplateIds) ||
      selectedTemplateIds.some((item) => typeof item !== "string"))
  ) {
    throw new RuntimeError(
      "選択文書が不正です",
      400,
      "SETUP_TEMPLATE"
    );
  }
  const rawResolutions = input.conflictResolutions ?? {};
  if (
    !rawResolutions ||
    typeof rawResolutions !== "object" ||
    Array.isArray(rawResolutions)
  ) {
    throw new RuntimeError(
      "競合時の処理が不正です",
      400,
      "SETUP_RESOLUTION"
    );
  }
  const conflictResolutions: Record<string, "skip" | "alternate"> = {};
  for (const [templateId, resolution] of Object.entries(rawResolutions)) {
    if (resolution !== "skip" && resolution !== "alternate") {
      throw new RuntimeError(
        "競合時の処理が不正です",
        400,
        "SETUP_RESOLUTION"
      );
    }
    conflictResolutions[templateId] = resolution;
  }
  const contentRoot = input.contentRoot ?? "docs";
  const language = input.language ?? "ja";
  const rawFolderNames = input.folderNames ?? {};
  const rawPageFileNames = input.pageFileNames ?? {};
  if (
    typeof contentRoot !== "string" ||
    (language !== "ja" && language !== "en") ||
    !rawFolderNames ||
    typeof rawFolderNames !== "object" ||
    Array.isArray(rawFolderNames) ||
    Object.values(rawFolderNames).some((value) => typeof value !== "string") ||
    !rawPageFileNames ||
    typeof rawPageFileNames !== "object" ||
    Array.isArray(rawPageFileNames) ||
    Object.values(rawPageFileNames).some((value) => typeof value !== "string")
  ) {
    throw new RuntimeError("セットアップの保存先または言語が不正です", 400, "SETUP_INPUT");
  }
  return {
    profiles: profiles as SetupProfileId[],
    selectedTemplateIds: selectedTemplateIds as string[] | undefined,
    conflictResolutions,
    contentRoot,
    language,
    folderNames: rawFolderNames as Record<string, string>,
    pageFileNames: rawPageFileNames as Record<string, string>
  };
}

function publicPlan(plan: SetupPlan): Omit<SetupPlan, "projectRoot"> & {
  projectRoot: string;
} {
  return plan;
}

function diagnostic(
  code: string,
  message: string,
  itemPath?: string
): Diagnostic {
  return {
    file: ".",
    severity: "error",
    code,
    message,
    ...(itemPath ? { path: itemPath } : {})
  };
}

export async function startDevServer(options: {
  configPath: string;
  uiRoot: string;
  host?: string;
  port: number;
}): Promise<{ url: string; close(): Promise<void> }> {
  const host = options.host ?? "127.0.0.1";
  const allowedHosts: ReadonlySet<string> = isLoopbackHost(host)
    ? new Set(["localhost", "127.0.0.1", "[::1]", host.toLowerCase()])
    : new Set<string>();
  const configPath = path.resolve(options.configPath);
  const projectRoot = path.dirname(configPath);
  let loadedConfig: LoadedConfig | undefined;
  let snapshot: RepositorySnapshot | undefined;
  let state: "setup" | "config-error" | "ready" = "setup";
  let configDiagnostics: Diagnostic[] = [];
  let watcher: FSWatcher | undefined;
  let watcherState: "connecting" | "connected" | "error" = "connecting";
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcherRetryTimer: ReturnType<typeof setTimeout> | undefined;
  const clients = new Set<ServerResponse>();

  const publishChange = (kind = "repository-change") => {
    version += 1;
    for (const client of clients) {
      client.write(
        `data: ${JSON.stringify({
          version,
          kind,
          watcher: watcherState
        })}\n\n`
      );
    }
  };

  const closeWatcher = async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (watcherRetryTimer) clearTimeout(watcherRetryTimer);
    watcherRetryTimer = undefined;
    if (watcher) await watcher.close();
    watcher = undefined;
    watcherState = "connecting";
  };

  const startWatcher = () => {
    if (!loadedConfig || watcher) return;
    watcherState = "connecting";
    const activeWatcher = watch(loadedConfig.contentRoot, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: /(^|[/\\])\.[^/\\]*\.vellym-[^/\\]*\.tmp$/
    });
    watcher = activeWatcher;
    activeWatcher.once("ready", () => {
      if (watcher !== activeWatcher) return;
      watcherState = "connected";
      publishChange("watcher-ready");
    });
    activeWatcher.on("all", () => {
      if (watcher !== activeWatcher) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!loadedConfig || !snapshot) return;
        try {
          snapshot = await loadRepository(loadedConfig.contentRoot, snapshot);
        } catch (error) {
          snapshot = reloadFailureSnapshot(snapshot, error);
        }
        publishChange();
      }, 100);
    });
    activeWatcher.on("error", (error) => {
      if (watcher !== activeWatcher) return;
      if (snapshot) snapshot = reloadFailureSnapshot(snapshot, error);
      watcherState = "error";
      publishChange("watcher-error");
      if (watcherRetryTimer) clearTimeout(watcherRetryTimer);
      watcherRetryTimer = setTimeout(async () => {
        watcherRetryTimer = undefined;
        if (watcher !== activeWatcher) return;
        await activeWatcher.close();
        watcher = undefined;
        startWatcher();
      }, 1000);
    });
  };

  const activateReady = async () => {
    const nextConfig = await loadConfig(configPath);
    const nextSnapshot = await loadRepository(nextConfig.contentRoot);
    await closeWatcher();
    loadedConfig = nextConfig;
    snapshot = nextSnapshot;
    configDiagnostics = [];
    state = "ready";
    startWatcher();
  };

  try {
    await access(configPath);
    try {
      await activateReady();
    } catch (error) {
      const runtime =
        error instanceof RuntimeError
          ? error
          : new RuntimeError(
              error instanceof Error ? error.message : String(error),
              500,
              "CONFIG_ERROR"
            );
      state = "config-error";
      configDiagnostics = [
        diagnostic(
          runtime.code,
          runtime.message.replaceAll(projectRoot, ".")
        )
      ];
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      state = "setup";
    } else {
      state = "config-error";
      configDiagnostics = [
        diagnostic(
          "CONFIG_ACCESS",
          "設定ファイルへアクセスできません"
        )
      ];
    }
  }

  const requireReady = (): {
    loadedConfig: LoadedConfig;
    snapshot: RepositorySnapshot;
  } => {
    if (state !== "ready" || !loadedConfig || !snapshot) {
      throw new RuntimeError(
        "プロジェクトは利用可能な状態ではありません",
        409,
        "PROJECT_NOT_READY"
      );
    }
    return { loadedConfig, snapshot };
  };

  const requireSetup = () => {
    if (state !== "setup") {
      throw new RuntimeError(
        "セットアップを開始できる状態ではありません",
        409,
        "SETUP_NOT_AVAILABLE"
      );
    }
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      assertAllowedHost(request.headers.host, allowedHosts);
      assertAllowedOrigin(
        request.method,
        request.headers.origin,
        request.headers.host
      );
      if (
        url.pathname === "/api/v1/bootstrap" &&
        request.method === "GET"
      ) {
        const localeState = localeRequest(
          url,
          loadedConfig?.config ?? { ui: { language: "ja" } }
        );
        json(
          response,
          200,
          envelope(
            {
              state,
              project: {
                projectRoot,
                contentRoot:
                  loadedConfig?.config.contentRoot ?? "docs",
                resolvedContentRoot:
                  loadedConfig?.contentRoot ?? path.join(projectRoot, "docs"),
                language: loadedConfig?.config.ui.language ?? "ja",
                defaultLocale: localeState.defaultLocale,
                requestedLocale: localeState.requestedLocale,
                resolvedLocale: localeState.requestedLocale,
                uiLocale: localeState.uiLocale,
                availableLocales: snapshot
                  ? availableProjectLocales(snapshot, localeState.defaultLocale)
                  : [localeState.defaultLocale],
                configPath: path.relative(projectRoot, configPath) || "vellym.config.yaml"
              },
              capabilities: {
                repository: state === "ready",
                editing: state === "ready",
                search: state === "ready",
                structure: state === "ready",
                setup: state === "setup",
                live: true
              }
            },
            configDiagnostics
          )
        );
        return;
      }
      if (
        url.pathname === "/api/v1/setup/profiles" &&
        request.method === "GET"
      ) {
        requireSetup();
        json(response, 200, envelope(setupManifest()));
        return;
      }
      if (
        url.pathname === "/api/v1/setup/plan" &&
        request.method === "POST"
      ) {
        requireSetup();
        const input = setupInput(await readJson(request));
        const plan = await planProjectSetup(projectRoot, input);
        json(response, 200, envelope(publicPlan(plan)));
        return;
      }
      if (
        url.pathname === "/api/v1/setup/apply" &&
        request.method === "POST"
      ) {
        requireSetup();
        const raw = await readJson(request);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new RuntimeError(
            "セットアップ入力が不正です",
            400,
            "SETUP_INPUT"
          );
        }
        const expectedHash = (raw as Record<string, unknown>).planHash;
        if (typeof expectedHash !== "string") {
          throw new RuntimeError(
            "plan hashが必要です",
            400,
            "SETUP_PLAN_HASH"
          );
        }
        const input = setupInput(raw);
        const plan = await planProjectSetup(projectRoot, input);
        if (plan.planHash !== expectedHash) {
          throw new RuntimeError(
            "preview後に対象が変更されました。もう一度確認してください",
            409,
            "SETUP_PLAN_CONFLICT"
          );
        }
        await applyProjectSetup(plan);
        await activateReady();
        publishChange("setup-complete");
        json(
          response,
          200,
          envelope({
            state: "ready",
            created: plan.files.filter((file) => file.status === "create"),
            skipped: plan.files.filter((file) => file.status === "skip")
          })
        );
        return;
      }
      if (
        url.pathname === "/api/v1/repository" &&
        request.method === "GET"
      ) {
        const ready = requireReady();
        const localeState = localeRequest(url, ready.loadedConfig.config);
        json(
          response,
          200,
          envelope(
            {
              locale: localeState.requestedLocale,
              defaultLocale: localeState.defaultLocale,
              availableLocales: availableProjectLocales(
                ready.snapshot,
                localeState.defaultLocale
              ),
              pages: localizedPageSummaries(
                ready.snapshot,
                localeState.requestedLocale,
                localeState.defaultLocale
              ),
              folders: localizedFolderSummaries(
                ready.snapshot,
                localeState.requestedLocale,
                localeState.defaultLocale
              )
            },
            ready.snapshot.diagnostics
          )
        );
        return;
      }
      if (
        url.pathname === "/api/v1/config/content-root/plan" &&
        request.method === "POST"
      ) {
        requireReady();
        const raw = await readJson(request);
        const contentRoot =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>).contentRoot
            : undefined;
        if (typeof contentRoot !== "string") {
          throw new RuntimeError("contentRootが必要です", 400, "CONTENT_ROOT");
        }
        json(
          response,
          200,
          envelope(await planContentRootChange(configPath, contentRoot))
        );
        return;
      }
      if (
        url.pathname === "/api/v1/config/content-root/apply" &&
        request.method === "POST"
      ) {
        requireReady();
        const raw = await readJson(request);
        const plan =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>).plan
            : undefined;
        if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
          throw new RuntimeError("contentRoot planが必要です", 400, "CONTENT_ROOT");
        }
        const previous = await applyContentRootChange(
          configPath,
          plan as ContentRootPlan
        );
        try {
          await activateReady();
        } catch (error) {
          await writeFile(configPath, previous.previousSource, "utf8");
          await activateReady();
          throw error;
        }
        publishChange("config-change");
        const localeState = localeRequest(url, loadedConfig!.config);
        json(response, 200, envelope({
          state: "ready",
          project: {
            projectRoot,
            contentRoot: loadedConfig!.config.contentRoot,
            resolvedContentRoot: loadedConfig!.contentRoot,
            language: loadedConfig!.config.ui.language,
            defaultLocale: localeState.defaultLocale,
            requestedLocale: localeState.requestedLocale,
            resolvedLocale: localeState.requestedLocale,
            uiLocale: localeState.uiLocale,
            availableLocales: availableProjectLocales(
              snapshot!,
              localeState.defaultLocale
            ),
            configPath: path.relative(projectRoot, configPath) || "vellym.config.yaml"
          }
        }));
        return;
      }
      if (
        url.pathname === "/api/v1/config/ui-language" &&
        request.method === "POST"
      ) {
        requireReady();
        const raw = await readJson(request);
        const language =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>).language
            : undefined;
        if (language !== "ja" && language !== "en") {
          throw new RuntimeError("languageはjaまたはenで指定してください", 400, "UI_LANGUAGE");
        }
        const previous = await applyUiLanguage(configPath, language);
        try {
          await activateReady();
        } catch (error) {
          await writeFile(configPath, previous.previousSource, "utf8");
          await activateReady();
          throw error;
        }
        publishChange("config-change");
        const localeState = localeRequest(url, loadedConfig!.config);
        json(response, 200, envelope({
          state: "ready",
          project: {
            projectRoot,
            contentRoot: loadedConfig!.config.contentRoot,
            resolvedContentRoot: loadedConfig!.contentRoot,
            language: loadedConfig!.config.ui.language,
            defaultLocale: localeState.defaultLocale,
            requestedLocale: localeState.requestedLocale,
            resolvedLocale: localeState.requestedLocale,
            uiLocale: localeState.uiLocale,
            availableLocales: availableProjectLocales(
              snapshot!,
              localeState.defaultLocale
            ),
            configPath: path.relative(projectRoot, configPath) || "vellym.config.yaml"
          }
        }));
        return;
      }
      if (
        url.pathname === "/api/v1/pages/slug-migration/plan" &&
        request.method === "POST"
      ) {
        const ready = requireReady();
        json(
          response,
          200,
          envelope(await planSlugMigration(ready.loadedConfig.contentRoot))
        );
        return;
      }
      if (
        url.pathname === "/api/v1/pages/slug-migration/apply" &&
        request.method === "POST"
      ) {
        const ready = requireReady();
        const body = await readJson(request);
        const plan =
          body && typeof body === "object" && "plan" in body
            ? (body as { plan: unknown }).plan
            : undefined;
        if (!plan || typeof plan !== "object") {
          throw new RuntimeError(
            "slug migration planが必要です",
            400,
            "SLUG_MIGRATION"
          );
        }
        const result = await applySlugMigration(
          ready.loadedConfig.contentRoot,
          plan as SlugMigrationPlan
        );
        snapshot = await loadRepository(ready.loadedConfig.contentRoot, snapshot);
        publishChange("repository-change");
        json(response, 200, envelope(result));
        return;
      }
      if (
        url.pathname === "/api/v1/structure/archived" &&
        request.method === "GET"
      ) {
        const ready = requireReady();
        json(
          response,
          200,
          envelope({
            entries: await listArchived(ready.loadedConfig.contentRoot)
          })
        );
        return;
      }
      if (
        url.pathname === "/api/v1/structure/plan" &&
        request.method === "POST"
      ) {
        const ready = requireReady();
        const plan = await planStructureChange(
          ready.loadedConfig.contentRoot,
          await readJson(request)
        );
        json(response, 200, envelope(plan));
        return;
      }
      if (
        url.pathname === "/api/v1/structure/apply" &&
        request.method === "POST"
      ) {
        const ready = requireReady();
        const raw = await readJson(request);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new RuntimeError(
            "構成変更planが不正です",
            400,
            "STRUCTURE_PLAN"
          );
        }
        const plan = (raw as Record<string, unknown>).plan;
        if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
          throw new RuntimeError(
            "構成変更planが必要です",
            400,
            "STRUCTURE_PLAN"
          );
        }
        const expected = plan as StructurePlan;
        if (
          typeof expected.planHash !== "string" ||
          !Array.isArray(expected.changes) ||
          !expected.input
        ) {
          throw new RuntimeError(
            "構成変更planが不正です",
            400,
            "STRUCTURE_PLAN"
          );
        }
        const applied = await applyStructureChange(
          ready.loadedConfig.contentRoot,
          expected
        );
        snapshot = await loadRepository(ready.loadedConfig.contentRoot, snapshot);
        publishChange("repository-change");
        json(
          response,
          200,
          envelope({
            applied: expected.changes,
            ...(applied.undoPlan ? { undoPlan: applied.undoPlan } : {}),
            pages: pageSummaries(snapshot),
            folders: snapshot.folders
          }, snapshot.diagnostics)
        );
        return;
      }
      if (
        url.pathname === "/api/v1/structure/undo" &&
        request.method === "POST"
      ) {
        const ready = requireReady();
        const raw = await readJson(request);
        const plan =
          raw && typeof raw === "object" && !Array.isArray(raw) && "plan" in raw
            ? (raw as { plan: unknown }).plan
            : undefined;
        if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
          throw new RuntimeError(
            "undo planが必要です",
            400,
            "STRUCTURE_UNDO"
          );
        }
        await applyStructureUndo(
          ready.loadedConfig.contentRoot,
          plan as StructureUndoPlan
        );
        snapshot = await loadRepository(ready.loadedConfig.contentRoot, snapshot);
        publishChange("repository-change");
        json(
          response,
          200,
          envelope({
            pages: pageSummaries(snapshot),
            folders: snapshot.folders
          }, snapshot.diagnostics)
        );
        return;
      }
      if (
        url.pathname === "/api/v1/search" &&
        request.method === "GET"
      ) {
        const ready = requireReady();
        const localeState = localeRequest(url, ready.loadedConfig.config);
        const query = url.searchParams.get("q")?.trim() ?? "";
        if (!query) {
          throw new RuntimeError(
            "検索語を指定してください",
            400,
            "SEARCH_QUERY"
          );
        }
        json(
          response,
          200,
          envelope(
            localizedSearchRepository(
              ready.snapshot,
              query,
              localeState.requestedLocale,
              localeState.defaultLocale
            ),
            ready.snapshot.diagnostics
          )
        );
        return;
      }
      if (
        url.pathname === "/api/v1/folders" &&
        request.method === "PATCH"
      ) {
        const ready = requireReady();
        const patch = parseFolderPatch(await readJson(request));
        const saved = await saveFolder(
          ready.loadedConfig.contentRoot,
          patch,
          resolveDefaultLocale(ready.loadedConfig.config)
        );
        snapshot = await loadRepository(ready.loadedConfig.contentRoot, snapshot);
        publishChange("repository-change");
        json(response, 200, envelope(saved, snapshot.diagnostics));
        return;
      }
      const pageEditMatch = url.pathname.match(
        /^\/api\/v1\/pages\/([a-z0-9-]+)\/edit$/
      );
      if (url.pathname === "/api/v1/folders/edit" && request.method === "GET") {
        const ready = requireReady();
        const folderPath = url.searchParams.get("path") ?? "";
        const editable = editableFolder(
          ready.snapshot,
          folderPath,
          resolveDefaultLocale(ready.loadedConfig.config)
        );
        if (!editable) {
          throw new RuntimeError("Folderが見つかりません", 404, "NOT_FOUND");
        }
        json(response, 200, envelope(editable, ready.snapshot.diagnostics));
        return;
      }
      if (pageEditMatch && request.method === "GET") {
        const ready = requireReady();
        const editable = await editablePage(
          ready.snapshot,
          pageEditMatch[1]!,
          resolveDefaultLocale(ready.loadedConfig.config)
        );
        if (!editable) {
          throw new RuntimeError("Pageが見つかりません", 404, "NOT_FOUND");
        }
        json(response, 200, envelope(editable, ready.snapshot.diagnostics));
        return;
      }
      const pageMatch = url.pathname.match(
        /^\/api\/v1\/pages\/([a-z0-9-]+)$/
      );
      if (pageMatch && request.method === "GET") {
        const ready = requireReady();
        const localeState = localeRequest(url, ready.loadedConfig.config);
        const requestedPage = pageMatch[1]!;
        const pageId = ready.snapshot.byName.has(requestedPage)
          ? requestedPage
          : ready.snapshot.pages.find((entry) => entry.slug === requestedPage)?.name;
        const localized = await localizedPage(
          ready.snapshot,
          pageId ?? requestedPage,
          localeState.requestedLocale,
          localeState.defaultLocale
        );
        if (!localized) {
          throw new RuntimeError(
            "Pageが見つかりません",
            404,
            "NOT_FOUND"
          );
        }
        json(response, 200, envelope(localized, ready.snapshot.diagnostics));
        return;
      }
      if (pageMatch && request.method === "PATCH") {
        const ready = requireReady();
        const loaded = ready.snapshot.byName.get(pageMatch[1]!);
        if (!loaded) {
          throw new RuntimeError(
            "Pageが見つかりません",
            404,
            "NOT_FOUND"
          );
        }
        const patch = parsePagePatch(await readJson(request));
        const saved = await savePage(
          ready.loadedConfig.contentRoot,
          loaded,
          patch,
          resolveDefaultLocale(ready.loadedConfig.config),
          ready.snapshot
        );
        snapshot = await loadRepository(ready.loadedConfig.contentRoot, snapshot);
        json(response, 200, envelope(saved, snapshot.diagnostics));
        return;
      }
      if (
        url.pathname === "/api/v1/events" &&
        request.method === "GET"
      ) {
        requireReady();
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        response.write(
          `retry: 1000\ndata: ${JSON.stringify({
            version,
            kind: "connected",
            watcher: watcherState
          })}\n\n`
        );
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }
      if (request.method !== "GET") {
        throw new RuntimeError("Not found", 404, "NOT_FOUND");
      }
      let requested: string;
      try {
        requested =
          url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      } catch {
        throw new RuntimeError("Not found", 404, "NOT_FOUND");
      }
      const uiRoot = path.resolve(options.uiRoot);
      const candidate = path.resolve(uiRoot, requested);
      const filePath = isInside(uiRoot, candidate)
        ? candidate
        : path.join(uiRoot, "index.html");
      const extension = path.extname(filePath).toLowerCase();
      let body: Buffer;
      let served = filePath;
      try {
        body = await readFile(filePath);
      } catch {
        // 拡張子を持つ要求はアセットとして扱い、SPAのindex.htmlで代替しない。
        // 代替するとimageやfontの取得失敗が200のHTMLとして返り、原因が分からなくなる。
        if (extension && extension !== ".html") {
          throw new RuntimeError("Not found", 404, "NOT_FOUND");
        }
        served = path.join(uiRoot, "index.html");
        body = await readFile(served);
      }
      if (served === path.join(uiRoot, "index.html")) {
        body = dynamicIndexHtml(body);
      }
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": contentTypeFor(path.extname(served).toLowerCase())
      });
      response.end(body);
    } catch (error) {
      if (error instanceof RuntimeError) {
        json(
          response,
          error.status,
          envelope(null, [
            diagnostic(
              error.code,
              error.message.replaceAll(projectRoot, "."),
              error.path
            )
          ])
        );
        return;
      }
      // 想定外の例外は原因をそのまま返さない。fsのerror等はprojectRoot外の
      // 絶対pathを含みうるため、詳細は起動した端末のstderrへ出し、
      // 応答は固定文言に留める。
      process.stderr.write(
        `[vellym] 予期しないエラー: ${
          error instanceof Error ? (error.stack ?? error.message) : String(error)
        }\n`
      );
      json(
        response,
        500,
        envelope(null, [
          diagnostic(
            "INTERNAL",
            "サーバー内部でエラーが発生しました。詳細は起動した端末の出力を確認してください"
          )
        ])
      );
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, host, resolve);
    });
  } catch (error) {
    await closeWatcher();
    throw error;
  }
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : options.port;
  const accessHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return {
    url: `http://${accessHost}:${actualPort}`,
    async close() {
      await closeWatcher();
      for (const client of clients) client.end();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };
}
