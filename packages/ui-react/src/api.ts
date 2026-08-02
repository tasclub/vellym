import type {
  Diagnostic,
  FolderSummary,
  PageSummary,
  PageView,
  SearchProjection
} from "@vellym-internal/core";

export interface Envelope<T> {
  schemaVersion: string;
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

export type SetupProfileId =
  | "minimal"
  | "software-basic"
  | "arc42"
  | "project-management"
  | "product-planning";

export interface SetupProfile {
  id: SetupProfileId;
  title: string;
  templateIds: string[];
}

export interface SetupTemplate {
  id: string;
  relativePath: string;
  pageId: string;
  title: string;
  description: string;
  defaultSelected?: boolean;
  defaultFileName?: string;
  editableFileName?: boolean;
}

export interface SetupManifest {
  profiles: SetupProfile[];
  templates: SetupTemplate[];
}

export interface SetupInput {
  profiles: SetupProfileId[];
  selectedTemplateIds: string[];
  conflictResolutions: Record<string, "skip" | "alternate">;
  contentRoot: string;
  language: "ja" | "en";
  folderNames: Record<string, string>;
  pageFileNames: Record<string, string>;
}

export interface SetupPlan {
  profiles: SetupProfileId[];
  selectedTemplateIds: string[];
  conflictResolutions: Record<string, "skip" | "alternate">;
  projectRoot: string;
  contentRoot: string;
  language: "ja" | "en";
  folderNames: Record<string, string>;
  pageFileNames: Record<string, string>;
  files: Array<{
    relativePath: string;
    templateId?: string;
    pageId?: string;
    slug?: string;
    title: string;
    status: "create" | "conflict" | "skip";
    conflictReason?: "path" | "page-id";
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
  constructor(
    message: string,
    public readonly status: number,
    public readonly diagnostics: Diagnostic[]
  ) {
    super(message);
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
    __VELLYM_STATIC__?: { dataBase: string };
  }
}

// 静的配信では、同じSPAがHTTP APIの代わりにビルド時へ焼き込んだJSONを読む。
// 静的index.htmlが window.__VELLYM_STATIC__ を注入している場合だけ静的経路になる。
function staticBase(): string | undefined {
  return typeof window !== "undefined"
    ? window.__VELLYM_STATIC__?.dataBase
    : undefined;
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
  return result as Envelope<T>;
}

export function fetchBootstrap(
  signal?: AbortSignal
): Promise<Envelope<BootstrapData>> {
  const base = staticBase();
  if (base) return fetchStatic<BootstrapData>(base, "bootstrap.json");
  return request("/api/v1/bootstrap", { signal });
}

export function fetchSetupManifest(
  signal?: AbortSignal
): Promise<Envelope<SetupManifest>> {
  return request("/api/v1/setup/profiles", { signal });
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
  planHash: string
): Promise<Envelope<SetupApplyResult>> {
  return request("/api/v1/setup/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, planHash })
  });
}

export async function fetchPages(
  signal?: AbortSignal
): Promise<Envelope<{ pages: PageSummary[]; folders: FolderSummary[] }>> {
  const base = staticBase();
  if (base) {
    return fetchStatic<{ pages: PageSummary[]; folders: FolderSummary[] }>(
      base,
      "repository.json"
    );
  }
  return request("/api/v1/repository", { signal });
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

export async function fetchPage(
  name: string,
  signal?: AbortSignal
): Promise<Envelope<PageView>> {
  const base = staticBase();
  if (base) {
    return fetchStatic<PageView>(base, `pages/${encodeURIComponent(name)}.json`);
  }
  return request(`/api/v1/pages/${name}`, { signal });
}

export function fetchSearch(
  query: string,
  signal?: AbortSignal
): Promise<Envelope<SearchProjection>> {
  return request(`/api/v1/search?q=${encodeURIComponent(query)}`, { signal });
}

export async function patchPage(
  name: string,
  patch: {
    baseHash: string;
    title?: string;
    slug?: string;
    richTextBlocks?: Array<{ id: string; content: string }>;
  }
): Promise<Envelope<PageView>> {
  return request(`/api/v1/pages/${name}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
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
