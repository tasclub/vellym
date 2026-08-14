import type {
  Diagnostic,
  FolderSummary,
  FolderEditView,
  PageSummary,
  PageEditView,
  PageView,
  SearchProjection
} from "@vellym-internal/core";

export interface Envelope<T> {
  /** HTTP応答と静的データの封筒形式の版。 */
  apiSchemaVersion: string;
  buildId?: string;
  data: T;
  diagnostics: Diagnostic[];
}

export interface BootstrapData {
  state: "setup" | "config-error" | "ready";
  project: {
    projectRoot: string;
    contentRoot: string;
    resolvedContentRoot: string;
    language: "ja" | "en";
    defaultLocale: string;
    requestedLocale: string;
    resolvedLocale: string;
    uiLocale: string;
    availableLocales: string[];
    configPath: string;
  };
  capabilities: {
    repository: boolean;
    editing: boolean;
    search: boolean;
    structure: boolean;
    setup: boolean;
    live: boolean;
  };
}

export interface RepositoryData {
  locale: string;
  defaultLocale: string;
  availableLocales: string[];
  pages: PageSummary[];
  folders: FolderSummary[];
}

export type SetupMode = "recommended" | "templates" | "empty";
export type ProjectSize = "personal" | "small-team" | "medium-large";
export type DevelopmentMethod = "agile" | "hybrid" | "waterfall";
export type DocumentationLevel = "light" | "standard" | "strict";
export type SetupOperation = "initialize" | "add";
export type SetupReferenceModel =
  | "iso-12207"
  | "pmbok"
  | "iso-29148"
  | "arc42"
  | "adr"
  | "c4-model"
  | "security";

export interface SetupCatalogFolder {
  id: string;
  parentId?: string;
  areaId: string;
  order: number;
  referenceModels: SetupReferenceModel[];
  title: string;
  defaultName: string;
  description: string;
}

export interface SetupCatalogPage {
  id: string;
  parentFolderId?: string;
  order: number;
  areaId?: string;
  requiredness: "core" | "recommended" | "conditional" | "optional";
  minimumLevel: DocumentationLevel;
  sizes: ProjectSize[];
  methods: DevelopmentMethod[];
  dependencies?: string[];
  related?: string[];
  templateFamilyId?: string;
  referenceModels: SetupReferenceModel[];
  version: string;
  title: string;
  defaultFileName: string;
  description: string;
}

export interface SetupCatalog {
  packId: string;
  packVersion: string;
  packSchemaVersion: string;
  locale: "ja" | "en";
  areas: Array<{ id: string; order: number; title: string }>;
  folders: SetupCatalogFolder[];
  pages: SetupCatalogPage[];
  referenceModels: SetupReferenceModel[];
  sizes: ProjectSize[];
  methods: DevelopmentMethod[];
  levels: DocumentationLevel[];
}

export interface SetupInput {
  operation?: SetupOperation;
  mode?: SetupMode;
  size?: ProjectSize;
  method?: DevelopmentMethod;
  level?: DocumentationLevel;
  selectedTemplateIds?: string[];
  selectedFolderIds?: string[];
  conflictResolutions: Record<string, "skip" | "alternate">;
  contentRoot: string;
  language: "ja" | "en";
  folderNames: Record<string, string>;
  pageFileNames: Record<string, string>;
  pageTitles: Record<string, string>;
  plannedPageIds?: Record<string, string>;
}

export interface SetupPlan {
  operation: SetupOperation;
  mode?: SetupMode;
  size?: ProjectSize;
  method?: DevelopmentMethod;
  level?: DocumentationLevel;
  selectedTemplateIds: string[];
  selectedFolderIds: string[];
  conflictResolutions: Record<string, "skip" | "alternate">;
  projectRoot: string;
  contentRoot: string;
  language: "ja" | "en";
  folderNames: Record<string, string>;
  pageFileNames: Record<string, string>;
  pageTitles: Record<string, string>;
  plannedPageIds: Record<string, string>;
  recommendationReasons: Record<string, string>;
  recommendationReasonKinds: Record<string, "criteria" | "dependency" | "ancestor" | "explicit">;
  files: Array<{
    relativePath: string;
    kind?: "page" | "folder" | "config";
    nodeId?: string;
    templateId?: string;
    folderId?: string;
    parentFolderId?: string;
    areaId?: string;
    pageId?: string;
    slug?: string;
    title: string;
    status: "create" | "reuse" | "skip" | "conflict";
    conflictReason?: "path" | "page-id" | "template-existing" | "ancestor";
  }>;
  planHash: string;
}

export interface SetupApplyResult {
  state: "ready";
  created: SetupPlan["files"];
  skipped: SetupPlan["files"];
}

export interface ContentRootPlan {
  contentRoot: string;
  resolvedContentRoot: string;
  exists: boolean;
  pages: number;
  diagnostics: number;
  planHash: string;
}

export interface SlugMigrationPlan {
  pages: Array<{ pageId: string; title: string; slug: string }>;
  planHash: string;
}

export type StructureInput =
  | {
      type: "create-page";
      title: string;
      parentPath: string;
      pageId?: string;
      slug?: string;
    }
  | { type: "create-folder"; name: string; parentPath: string }
  | {
      type: "update-folder";
      folderPath: string;
      title: string;
      description: string;
    }
  | {
      type: "move-page";
      pageId: string;
      destinationPath: string;
      destinationOrder?: string[];
    }
  | { type: "rename-page-file"; pageId: string; fileName: string }
  | {
      type: "move-folder";
      folderPath: string;
      destinationPath: string;
      destinationOrder?: string[];
    }
  | { type: "reorder"; folderPath: string; order: string[] }
  | { type: "archive-page"; pageId: string }
  | { type: "archive-folder"; folderPath: string }
  | { type: "restore"; archivePath: string };

export interface ArchivedEntry {
  archivePath: string;
  type: "page" | "folder";
  title: string;
}

export interface StructurePlan {
  input: StructureInput;
  title: string;
  changes: Array<{
    operation: "create" | "update" | "move" | "archive" | "restore";
    source?: string;
    destination: string;
  }>;
  warnings: string[];
  affectedPages: number;
  executable: boolean;
  conflict?: string;
  planHash: string;
}

export interface StructureApplyResult {
  applied: StructurePlan["changes"];
  undoPlan?: StructureUndoPlan;
  pages: PageSummary[];
  folders: FolderSummary[];
}

export interface StructureUndoPlan {
  expectedRepositoryHash: string;
  move?: { source: string; destination: string };
  folderMetadata: Array<{ relativePath: string; source?: string }>;
  planHash: string;
}

export class ApiError extends Error {
  // serverが返す安定した識別子。表示文言はUI側でこのcodeから引く。
  readonly code: string | undefined;

  constructor(
    message: string,
    public readonly status: number,
    public readonly diagnostics: Diagnostic[]
  ) {
    super(message);
    this.code = diagnostics[0]?.code;
  }
}

async function request<T>(
  input: string,
  init?: RequestInit
): Promise<Envelope<T>> {
  const response = await fetch(input, init);
  let result: Envelope<T | null>;
  try {
    result = (await response.json()) as Envelope<T | null>;
  } catch {
    throw new ApiError("サーバー応答を解析できません", response.status, []);
  }
  if (!response.ok || result.data === null) {
    throw new ApiError(
      result.diagnostics[0]?.message ?? `HTTP ${response.status}`,
      response.status,
      result.diagnostics
    );
  }
  return result as Envelope<T>;
}

declare global {
  interface Window {
    __VELLYM_STATIC__?: {
      appBase: string;
      assetBase: string;
      dataBase: string;
      buildId: string;
      locale: string;
      defaultLocale: string;
    };
  }
}

// 静的配信では、同じSPAがHTTP APIの代わりにビルド時へ焼き込んだJSONを読む。
// 静的index.htmlが window.__VELLYM_STATIC__ を注入している場合だけ静的経路になる。
function staticBase(): string | undefined {
  if (typeof window === "undefined" || !window.__VELLYM_STATIC__) return undefined;
  const config = window.__VELLYM_STATIC__;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(config.appBase)) {
    const documentBase = document.baseURI;
    config.appBase = new URL(config.appBase, documentBase).href;
    config.assetBase = new URL(config.assetBase, documentBase).href;
    config.dataBase = new URL(config.dataBase, documentBase).href.replace(/\/$/, "");
  }
  return config.dataBase;
}

async function fetchStatic<T>(base: string, file: string): Promise<Envelope<T>> {
  const response = await fetch(`${base}/${file}`);
  let result: Envelope<T | null>;
  try {
    result = (await response.json()) as Envelope<T | null>;
  } catch {
    throw new ApiError("静的データを解析できません", response.status, []);
  }
  if (!response.ok || result.data === null) {
    throw new ApiError(
      result.diagnostics[0]?.message ?? `HTTP ${response.status}`,
      response.status,
      result.diagnostics
    );
  }
  const expectedBuild = window.__VELLYM_STATIC__?.buildId;
  if (expectedBuild && result.buildId !== expectedBuild) {
    throw new ApiError("静的サイトのHTMLとデータの版が一致しません。再読み込みしてください", 409, [{
      file: file,
      severity: "error",
      code: "STATIC_BUILD_MISMATCH",
      message: "静的サイトのHTMLとデータのbuild IDが一致しません"
    }]);
  }
  return result as Envelope<T>;
}

export function fetchBootstrap(
  signal?: AbortSignal,
  locale?: string
): Promise<Envelope<BootstrapData>> {
  const base = staticBase();
  if (base) return fetchStatic<BootstrapData>(base, "bootstrap.json");
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  return request(`/api/v1/bootstrap${query}`, { signal });
}

export function fetchSetupCatalog(
  language: "ja" | "en",
  signal?: AbortSignal
): Promise<Envelope<SetupCatalog>> {
  return request(`/api/v1/setup/catalog?language=${language}`, { signal });
}

export function previewSetup(
  input: SetupInput
): Promise<Envelope<SetupPlan>> {
  return request("/api/v1/setup/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function applySetup(
  input: SetupInput,
  plan: Pick<SetupPlan, "planHash" | "plannedPageIds">
): Promise<Envelope<SetupApplyResult>> {
  return request("/api/v1/setup/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      planHash: plan.planHash,
      plannedPageIds: plan.plannedPageIds
    })
  });
}

export async function fetchPages(
  signal?: AbortSignal,
  locale?: string
): Promise<Envelope<RepositoryData>> {
  const base = staticBase();
  if (base) {
    return fetchStatic<RepositoryData>(
      base,
      "repository.json"
    );
  }
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  return request(`/api/v1/repository${query}`, { signal });
}

export function previewContentRoot(
  contentRoot: string
): Promise<Envelope<ContentRootPlan>> {
  return request("/api/v1/config/content-root/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentRoot })
  });
}

export function applyContentRoot(
  plan: ContentRootPlan
): Promise<Envelope<{ state: "ready"; project: BootstrapData["project"] }>> {
  return request("/api/v1/config/content-root/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan })
  });
}

export function applyUiLanguage(
  language: "ja" | "en"
): Promise<Envelope<{ state: "ready"; project: BootstrapData["project"] }>> {
  return request("/api/v1/config/ui-language", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language })
  });
}

export function previewSlugMigration(): Promise<Envelope<SlugMigrationPlan>> {
  return request("/api/v1/pages/slug-migration/plan", { method: "POST" });
}

export function applySlugMigration(
  plan: SlugMigrationPlan
): Promise<Envelope<{ migrated: number }>> {
  return request("/api/v1/pages/slug-migration/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan })
  });
}

export function fetchPage(
  name: string,
  signal?: AbortSignal
): Promise<Envelope<PageView>>;
export function fetchPage(
  name: string,
  signal: AbortSignal | undefined,
  locale: string
): Promise<Envelope<PageView>>;
export async function fetchPage(
  name: string,
  signal?: AbortSignal,
  locale?: string
): Promise<Envelope<PageView>> {
  const base = staticBase();
  if (base) {
    return fetchStatic<PageView>(base, `pages/${encodeURIComponent(name)}.json`);
  }
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  return request(`/api/v1/pages/${name}${query}`, { signal });
}

export function fetchPageEdit(
  name: string,
  signal?: AbortSignal
): Promise<Envelope<PageEditView>> {
  return request(`/api/v1/pages/${encodeURIComponent(name)}/edit`, { signal });
}

export function fetchSearch(
  query: string,
  signal?: AbortSignal,
  locale?: string
): Promise<Envelope<SearchProjection>> {
  const localeQuery = locale ? `&locale=${encodeURIComponent(locale)}` : "";
  return request(`/api/v1/search?q=${encodeURIComponent(query)}${localeQuery}`, { signal });
}

export async function patchPage(
  name: string,
  patch: {
    baseHash: string;
    title?: string;
    slug?: string;
    richTextBlocks?: Array<{ id: string; content: string }>;
    localeChanges?: Array<{
      locale: string;
      operation: "create" | "update";
      baselineHash?: string;
      visibility?: "draft" | "published";
      initialize?:
        | { type: "empty" }
        | { type: "copy"; sourceLocale: string };
      title?: string;
      richTextBlocks?: Array<{ id: string; content: string }>;
    }>;
    removeLocales?: string[];
    removeTranslationKeys?: string[];
  }
): Promise<Envelope<PageView>> {
  return request(`/api/v1/pages/${name}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
}

export function patchFolder(patch: {
  folderPath: string;
  baseHash: string | null;
  localeChanges: Array<{
    locale: string;
    operation: "create" | "update";
    baselineHash?: string;
    visibility?: "draft" | "published";
    initialize?:
      | { type: "empty" }
      | { type: "copy"; sourceLocale: string };
    title?: string;
    description?: string | null;
  }>;
  removeLocales: string[];
  removeTranslationKeys?: string[];
}): Promise<Envelope<FolderSummary>> {
  return request("/api/v1/folders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
}

export function fetchFolderEdit(
  folderPath: string,
  signal?: AbortSignal
): Promise<Envelope<FolderEditView>> {
  return request(`/api/v1/folders/edit?path=${encodeURIComponent(folderPath)}`, { signal });
}

export function fetchArchived(): Promise<Envelope<{ entries: ArchivedEntry[] }>> {
  return request("/api/v1/structure/archived");
}

export function previewStructure(
  input: StructureInput
): Promise<Envelope<StructurePlan>> {
  return request("/api/v1/structure/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function applyStructure(
  plan: StructurePlan
): Promise<Envelope<StructureApplyResult>> {
  return request("/api/v1/structure/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan })
  });
}

export function undoStructure(
  plan: StructureUndoPlan
): Promise<Envelope<Pick<StructureApplyResult, "pages" | "folders">>> {
  return request("/api/v1/structure/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan })
  });
}
