import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, stringify } from "yaml";
import {
  STABLE_API_VERSION,
  validateConfig,
  validateFolder,
  validatePage
} from "@vellym-internal/core";
import { loadConfig } from "./config.js";
import { RuntimeError } from "./errors.js";
import { loadRepository } from "./repository.js";
import { guideBody, type SetupLanguage } from "./setup-guide-bodies.js";
import type {
  DevelopmentMethod,
  DocumentationLevel,
  ProjectSize,
  SetupMode
} from "./setup-catalog.js";
import {
  SETUP_PACK,
  setupChildFolders,
  setupChildPages,
  setupFolder,
  setupFolderChain,
  setupFolders,
  setupPackLocale,
  setupPage,
  setupPages,
  type SetupFolderTemplate,
  type SetupPageTemplate
} from "./setup-pack.js";
import {
  recommendSetupNodes,
  resolveSetupSelection,
  setupReasonText,
  type SetupNodeReason,
  type SetupNodeSelection
} from "./setup-selection.js";

export type { SetupLanguage };
export type SetupOperation = "initialize" | "add";

const AREA_IDS = [
  "project-overview",
  "project-management",
  "requirements",
  "architecture",
  "design",
  "implementation",
  "quality",
  "release",
  "operations",
  "closure"
] as const;

export interface SetupCatalogFolder {
  id: string;
  parentId?: string;
  areaId: string;
  order: number;
  referenceModels: string[];
  title: string;
  defaultName: string;
  description: string;
}

export interface SetupCatalogPage {
  id: string;
  parentFolderId?: string;
  order: number;
  areaId?: string;
  requiredness: string;
  minimumLevel: DocumentationLevel;
  sizes: ProjectSize[];
  methods: DevelopmentMethod[];
  dependencies?: string[];
  related?: string[];
  templateFamilyId?: string;
  referenceModels: string[];
  version: string;
  title: string;
  defaultFileName: string;
  description: string;
}

export interface SetupCatalog {
  packId: string;
  packVersion: string;
  packSchemaVersion: string;
  locale: SetupLanguage;
  areas: Array<{ id: string; order: number; title: string }>;
  folders: SetupCatalogFolder[];
  pages: SetupCatalogPage[];
  referenceModels: string[];
  sizes: ProjectSize[];
  methods: DevelopmentMethod[];
  levels: DocumentationLevel[];
}

export interface SetupPlanFile {
  relativePath: string;
  kind: "page" | "folder" | "config" | "package-json";
  /** Catalog node this file comes from; absent for the root folder and config. */
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
  language: SetupLanguage;
  folderNames: Record<string, string>;
  pageFileNames: Record<string, string>;
  pageTitles: Record<string, string>;
  plannedPageIds: Record<string, string>;
  recommendationReasons: Record<string, string>;
  /** Why each node is present, so the UI can hide the trivial "user picked it". */
  recommendationReasonKinds: Record<string, SetupNodeReason["kind"]>;
  files: SetupPlanFile[];
  planHash: string;
}

export function setupCatalog(language: SetupLanguage = "ja"): SetupCatalog {
  const bundle = setupPackLocale(language);
  return {
    packId: SETUP_PACK.id,
    packVersion: SETUP_PACK.version,
    packSchemaVersion: SETUP_PACK.packSchemaVersion,
    locale: language,
    areas: AREA_IDS.map((id, order) => ({
      id,
      order,
      title: bundle.areas[id]?.title ?? id
    })),
    folders: setupFolders().map((folder) => ({
      ...folder,
      referenceModels: [...folder.referenceModels],
      title: bundle.folders[folder.id]!.title,
      defaultName: bundle.folders[folder.id]!.defaultName,
      description: bundle.folders[folder.id]!.description
    })),
    pages: setupPages().map((page) => ({
      ...page,
      sizes: [...page.sizes],
      methods: [...page.methods],
      referenceModels: [...page.referenceModels],
      ...(pageArea(page) ? { areaId: pageArea(page) } : {}),
      title: bundle.pages[page.id]!.title,
      defaultFileName: bundle.pages[page.id]!.defaultFileName,
      description: bundle.pages[page.id]!.description
    })),
    referenceModels: ["iso-12207", "pmbok", "iso-29148", "arc42", "adr", "c4-model", "security"],
    sizes: ["personal", "small-team", "medium-large"],
    methods: ["agile", "hybrid", "waterfall"],
    levels: ["light", "standard", "strict"]
  };
}

function pageArea(page: SetupPageTemplate): string | undefined {
  return page.parentFolderId ? setupFolder(page.parentFolderId)?.areaId : undefined;
}

function configSource(contentRoot: string, language: SetupLanguage): string {
  return stringify({
    schemaVersion: "1.0",
    contentRoot,
    outputDir: "dist/vellym",
    ui: { language },
    plugins: []
  }, { lineWidth: 0 });
}

/**
 * `plugins`をconfigDir起点で解決するためのアンカー。プラグインの導入先でもある。
 * `scripts`も`dependencies`もVellymは読まないため、最小構成だけを書く。
 */
function packageJsonSource(projectRoot: string): string {
  return `${JSON.stringify(
    {
      name: packageNameFrom(projectRoot),
      version: "0.0.0",
      private: true,
      type: "module"
    },
    undefined,
    2
  )}\n`;
}

/** ディレクトリ名をnpmの命名規則へ正規化する。`npm init`と同じ導出にする。 */
export function packageNameFrom(projectRoot: string): string {
  const normalized = path
    .basename(path.resolve(projectRoot))
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\-._~]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/-+$/, "")
    .slice(0, 214);
  return normalized || "vellym-project";
}

function pageSource(
  page: SetupPageTemplate,
  pageId: string,
  slug: string,
  language: SetupLanguage,
  titleOverride?: string,
  bodyOverride?: string
): string {
  const text = setupPackLocale(language).pages[page.id]!;
  const areaId = pageArea(page);
  return stringify({
    apiVersion: STABLE_API_VERSION,
    kind: "Page",
    metadata: {
      name: pageId,
      slug,
      title: titleOverride ?? text.title
    },
    spec: {
      locale: language,
      blocks: [
        {
          id: "body",
          type: "rich-text",
          content: bodyOverride ?? guideBody(page.id, language) ?? text.body
        }
      ]
    }
  }, { lineWidth: 0, blockQuote: "literal" });
}

function folderSource(
  title: string,
  order: string[],
  language: SetupLanguage,
  description?: string,
  areaId?: string,
  folderId?: string
): string {
  return stringify({
    apiVersion: STABLE_API_VERSION,
    kind: "Folder",
    metadata: {
      title
    },
    spec: {
      locale: language,
      ...(description ? { description } : {}),
      order
    }
  }, { lineWidth: 0 });
}

function safeRelativeRoot(value: string): string {
  const normalized = value.normalize("NFC").replace(/\/+$/g, "");
  if (
    !normalized ||
    normalized === "." ||
    path.isAbsolute(normalized) ||
    normalized.includes("\\") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new RuntimeError("contentRootはプロジェクト内の相対pathで指定してください", 400, "CONTENT_ROOT");
  }
  return normalized;
}

/**
 * Folder names are keyed by stable folder id. Keys from before the hierarchy
 * change used the information area id, so `requirements` is read as the root
 * folder `area-requirements` while a browser tab is mid-upgrade.
 */
function safeFolderNames(
  language: SetupLanguage,
  values: Record<string, string> | undefined
): Record<string, string> {
  const bundle = setupPackLocale(language);
  const result: Record<string, string> = {};
  for (const folder of setupFolders()) {
    result[folder.id] = bundle.folders[folder.id]!.defaultName;
  }
  for (const [rawKey, raw] of Object.entries(values ?? {})) {
    const key = setupFolder(rawKey) ? rawKey : `area-${rawKey}`;
    if (!setupFolder(key)) {
      throw new RuntimeError(`不明なFolderです: ${rawKey}`, 400, "SETUP_FOLDER_NAME");
    }
    const value = raw.normalize("NFC").trim();
    if (
      !value ||
      value === "." ||
      value === ".." ||
      value.startsWith(".") ||
      value === "_archive" ||
      /[\/\\\0]/.test(value) ||
      value.length > 200
    ) {
      throw new RuntimeError(`フォルダ名が不正です: ${rawKey}`, 400, "SETUP_FOLDER_NAME");
    }
    result[key] = value;
  }
  return result;
}

function safePageFileNames(
  values: Record<string, string> | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [templateId, raw] of Object.entries(values ?? {})) {
    if (!setupPage(templateId)) {
      throw new RuntimeError(`不明なtemplateです: ${templateId}`, 400, "SETUP_FILE_NAME");
    }
    const value = raw.normalize("NFC").trim();
    if (
      !value ||
      value.startsWith(".") ||
      value.toLocaleLowerCase() === "_index.yaml" ||
      !/\.ya?ml$/i.test(value) ||
      /[\/\\\0]/.test(value) ||
      value.length > 200
    ) {
      throw new RuntimeError(`初期Pageのファイル名が不正です: ${templateId}`, 400, "SETUP_FILE_NAME");
    }
    result[templateId] = value;
  }
  return result;
}

function safePageTitles(values: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [templateId, raw] of Object.entries(values ?? {})) {
    if (!setupPage(templateId)) {
      throw new RuntimeError(`不明なtemplateです: ${templateId}`, 400, "SETUP_PAGE_TITLE");
    }
    const value = raw.normalize("NFC").trim();
    if (!value || /[\0\r\n]/.test(value) || value.length > 200) {
      throw new RuntimeError(`Page名が不正です: ${templateId}`, 400, "SETUP_PAGE_TITLE");
    }
    result[templateId] = value;
  }
  return result;
}

function slugFromTitle(title: string): string {
  return title
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "page";
}

/** Directory of a catalog folder, built from its parent chain and the chosen names. */
function folderDirectory(
  folderId: string,
  contentRoot: string,
  folderNames: Record<string, string>
): string {
  const parts = setupFolderChain(folderId).map((folder) => folderNames[folder.id]!);
  return path.posix.join(contentRoot, ...parts);
}

function pageDirectory(
  page: SetupPageTemplate,
  contentRoot: string,
  folderNames: Record<string, string>
): string {
  return page.parentFolderId
    ? folderDirectory(page.parentFolderId, contentRoot, folderNames)
    : contentRoot;
}

async function exists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch { return false; }
}

async function isDirectory(target: string): Promise<boolean> {
  try { return (await stat(target)).isDirectory(); } catch { return false; }
}

function selectionFor(options: {
  mode?: SetupMode;
  size?: ProjectSize;
  method?: DevelopmentMethod;
  level?: DocumentationLevel;
  selectedTemplateIds?: string[];
  selectedFolderIds?: string[];
}): SetupNodeSelection {
  const known = (ids: string[] | undefined, lookup: (id: string) => unknown, code: string) => {
    for (const id of ids ?? []) {
      if (!lookup(id)) throw new RuntimeError(`不明なnodeです: ${id}`, 400, code);
    }
  };
  known(options.selectedTemplateIds, setupPage, "SETUP_TEMPLATE");
  known(options.selectedFolderIds, setupFolder, "SETUP_FOLDER");

  if (options.mode === "empty") {
    return resolveSetupSelection({ selectedPageIds: [], selectedFolderIds: [] });
  }
  if (options.mode === "recommended") {
    if (!options.size || !options.method || !options.level) {
      throw new RuntimeError(
        "おすすめ構成には規模、開発方式、levelが必要です",
        400,
        "SETUP_RECOMMENDATION"
      );
    }
    const recommended = recommendSetupNodes({
      size: options.size,
      method: options.method,
      level: options.level
    });
    // Once the user edits the proposal the explicit lists win, but the original
    // reasons are kept so the wizard can still explain each surviving node.
    if (options.selectedTemplateIds === undefined && options.selectedFolderIds === undefined) {
      return recommended;
    }
    return resolveSetupSelection({
      selectedPageIds: options.selectedTemplateIds ?? recommended.pageIds,
      selectedFolderIds: options.selectedFolderIds ?? recommended.explicitFolderIds,
      reasons: recommended.reasons
    });
  }
  return resolveSetupSelection({
    selectedPageIds: options.selectedTemplateIds ?? [],
    selectedFolderIds: options.selectedFolderIds ?? []
  });
}

function reasonTexts(
  selection: SetupNodeSelection,
  language: SetupLanguage
): Record<string, string> {
  const bundle = setupPackLocale(language);
  const titleOf = (nodeId: string): string =>
    bundle.pages[nodeId]?.title ?? bundle.folders[nodeId]?.title ?? nodeId;
  return Object.fromEntries(
    Object.entries(selection.reasons).map(([nodeId, reason]) => [
      nodeId,
      setupReasonText(reason as SetupNodeReason, language, titleOf)
    ])
  );
}

export async function planProjectSetup(
  projectRoot: string,
  options: {
    operation?: SetupOperation;
    mode?: SetupMode;
    size?: ProjectSize;
    method?: DevelopmentMethod;
    level?: DocumentationLevel;
    selectedTemplateIds?: string[];
    selectedFolderIds?: string[];
    conflictResolutions?: Record<string, "skip" | "alternate">;
    contentRoot?: string;
    language?: SetupLanguage;
    folderNames?: Record<string, string>;
    pageFileNames?: Record<string, string>;
    pageTitles?: Record<string, string>;
    plannedPageIds?: Record<string, string>;
  } = {}
): Promise<SetupPlan> {
  const root = path.resolve(projectRoot);
  const operation = options.operation ?? "initialize";
  const language = options.language ?? "ja";
  const relativeContentRoot = safeRelativeRoot(options.contentRoot ?? "docs");
  if (operation === "add") {
    const loaded = await loadConfig(path.join(root, "vellym.config.yaml"));
    if (path.resolve(root, relativeContentRoot) !== loaded.contentRoot) {
      throw new RuntimeError(
        "構成追加先は現在のcontent rootに限定されます",
        400,
        "SETUP_CONTENT_ROOT"
      );
    }
  }
  const bundle = setupPackLocale(language);
  const folderNames = safeFolderNames(language, options.folderNames);
  const pageFileNames = safePageFileNames(options.pageFileNames);
  const pageTitles = safePageTitles(options.pageTitles);
  const selection = selectionFor(options);
  const conflictResolutions = { ...(options.conflictResolutions ?? {}) };
  const files: SetupPlanFile[] = [];

  const contentRoot = path.join(root, relativeContentRoot);
  const existing = (await exists(contentRoot))
    ? await loadRepository(contentRoot)
    : undefined;
  const existingPageIds = new Set(existing?.byName.keys() ?? []);
  const existingSlugs = new Set(existing?.bySlug.keys() ?? []);
  // 生成済みテンプレートの検出はファイルpathで行う。生成後の内容は利用者が自由に
  // 書き換えるため、annotationsへ生成元を記録しても実態と乖離する。

  // --- folders, shallowest first so a blocked ancestor stops its whole subtree
  const blockedFolders = new Set<string>();
  const createdFolders = new Set<string>();
  for (const folderId of selection.folderIds) {
    const folder = setupFolder(folderId)!;
    const text = bundle.folders[folderId]!;
    const relativeDirectory = folderDirectory(folderId, relativeContentRoot, folderNames);
    const base: SetupPlanFile = {
      relativePath: path.posix.join(relativeDirectory, "_index.yaml"),
      kind: "folder",
      nodeId: folderId,
      folderId,
      ...(folder.parentId ? { parentFolderId: folder.parentId } : {}),
      areaId: folder.areaId,
      title: text.title,
      status: "create"
    };
    if (folder.parentId && blockedFolders.has(folder.parentId)) {
      blockedFolders.add(folderId);
      files.push({ ...base, status: "skip", conflictReason: "ancestor" });
      continue;
    }
    const target = path.join(root, relativeDirectory);
    if (await isDirectory(target)) {
      // Reuse the directory as a location without touching its own metadata.
      files.push({ ...base, status: "reuse" });
      continue;
    }
    if (await exists(target)) {
      // A file occupies the folder path: nothing under it can be created.
      blockedFolders.add(folderId);
      files.push({ ...base, status: "conflict", conflictReason: "ancestor" });
      continue;
    }
    createdFolders.add(folderId);
    files.push(base);
  }

  // --- pages
  const plannedPaths = new Set<string>();
  const plannedPageIds: Record<string, string> = {};
  for (const templateId of selection.pageIds) {
    const page = setupPage(templateId)!;
    const text = bundle.pages[templateId]!;
    const areaId = pageArea(page);
    const localizedTitle = pageTitles[templateId] ?? text.title;
    const fileName = pageFileNames[templateId] ?? text.defaultFileName;
    const relativePath = path.posix.join(
      pageDirectory(page, relativeContentRoot, folderNames),
      fileName
    );
    const base: SetupPlanFile = {
      relativePath,
      kind: "page",
      nodeId: templateId,
      templateId,
      ...(page.parentFolderId ? { parentFolderId: page.parentFolderId } : {}),
      ...(areaId ? { areaId } : {}),
      title: localizedTitle,
      status: "create"
    };

    if (page.parentFolderId && blockedFolders.has(page.parentFolderId)) {
      files.push({ ...base, status: "skip", conflictReason: "ancestor" });
      continue;
    }

    const pathKey = relativePath.normalize("NFC").toLocaleLowerCase();
    if (plannedPaths.has(pathKey)) {
      throw new RuntimeError(
        `初期Pageのファイル名が重複しています: ${relativePath}`,
        400,
        "SETUP_FILE_NAME"
      );
    }
    plannedPaths.add(pathKey);

    let pageId = options.plannedPageIds?.[templateId];
    if (pageId !== undefined && !/^page-[a-f0-9]{24}$/.test(pageId)) {
      throw new RuntimeError(`初期Page IDが不正です: ${templateId}`, 400, "SETUP_PAGE_ID");
    }
    if (pageId === undefined) {
      do {
        pageId = `page-${randomBytes(12).toString("hex")}`;
      } while (
        existingPageIds.has(pageId) ||
        Object.values(plannedPageIds).includes(pageId)
      );
    }
    plannedPageIds[templateId] = pageId;

    let slug = slugFromTitle(localizedTitle);
    let slugSuffix = 2;
    while (
      existingSlugs.has(slug.toLocaleLowerCase()) ||
      files.some((file) => file.slug?.toLocaleLowerCase() === slug.toLocaleLowerCase())
    ) {
      slug = `${slugFromTitle(localizedTitle)}-${slugSuffix++}`;
    }
    const identified = { ...base, pageId, slug };

    const target = path.join(root, relativePath);
    const pathConflict = await exists(target);
    // 構成追加では、同じpathに既にファイルがあるものを生成済みとみなしてskipする。
    if (operation === "add" && pathConflict) {
      files.push({
        ...identified,
        status: "skip",
        conflictReason: "template-existing"
      });
      continue;
    }
    const pageIdConflict = existingPageIds.has(pageId);
    if (!pathConflict && !pageIdConflict) {
      files.push(identified);
      continue;
    }
    const resolution = conflictResolutions[templateId];
    if (resolution === "skip") {
      files.push({
        ...identified,
        status: "skip",
        conflictReason: pageIdConflict ? "page-id" : "path"
      });
      continue;
    }
    if (resolution === "alternate" && !pageIdConflict) {
      const extension = path.extname(relativePath);
      const alternateBase = relativePath.slice(0, -extension.length);
      let suffix = 2;
      let alternatePath = `${alternateBase}-${suffix}${extension}`;
      while (await exists(path.join(root, alternatePath))) {
        suffix += 1;
        alternatePath = `${alternateBase}-${suffix}${extension}`;
      }
      files.push({ ...identified, relativePath: alternatePath });
      continue;
    }
    files.push({
      ...identified,
      status: "conflict",
      conflictReason: pageIdConflict ? "page-id" : "path"
    });
  }

  if (operation === "initialize") {
    files.push({
      relativePath: path.posix.join(relativeContentRoot, "_index.yaml"),
      kind: "folder",
      title: "Vellym root order",
      status: (await exists(path.join(root, relativeContentRoot, "_index.yaml")))
        ? "conflict"
        : "create"
    });
    files.push({
      relativePath: "vellym.config.yaml",
      kind: "config",
      title: "Vellym設定",
      status: (await exists(path.join(root, "vellym.config.yaml"))) ? "conflict" : "create"
    });
    // 既存のpackage.jsonは内容を検査せず触らない。利用者の依存記録だからである。
    files.push({
      relativePath: "package.json",
      kind: "package-json",
      title: "npm package定義",
      status: (await exists(path.join(root, "package.json"))) ? "conflict" : "create"
    });
  }

  const planHash = createHash("sha256")
    .update(
      JSON.stringify({
        operation,
        mode: options.mode,
        size: options.size,
        method: options.method,
        level: options.level,
        packVersion: SETUP_PACK.version,
        selectedTemplateIds: selection.pageIds,
        selectedFolderIds: selection.folderIds,
        explicitFolderIds: selection.explicitFolderIds,
        conflictResolutions,
        projectRoot: root,
        contentRoot: relativeContentRoot,
        language,
        folderNames,
        pageFileNames,
        pageTitles,
        plannedPageIds,
        files
      })
    )
    .digest("hex");

  return {
    operation,
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.size ? { size: options.size } : {}),
    ...(options.method ? { method: options.method } : {}),
    ...(options.level ? { level: options.level } : {}),
    selectedTemplateIds: selection.pageIds,
    selectedFolderIds: selection.explicitFolderIds,
    conflictResolutions,
    projectRoot: root,
    contentRoot: relativeContentRoot,
    language,
    folderNames,
    pageFileNames,
    pageTitles,
    plannedPageIds,
    recommendationReasons: reasonTexts(selection, language),
    recommendationReasonKinds: Object.fromEntries(
      Object.entries(selection.reasons).map(([nodeId, reason]) => [nodeId, reason.kind])
    ),
    files,
    planHash
  };
}

/** Basenames created directly under `folderId`, in catalog order. */
function childrenForFolder(plan: SetupPlan, folderId: string): string[] {
  const created = new Map(
    plan.files
      .filter((file) => file.status === "create" && file.nodeId)
      .map((file) => [file.nodeId!, file])
  );
  const children: string[] = [];
  for (const page of setupChildPages(folderId)) {
    const file = created.get(page.id);
    if (file?.kind === "page") children.push(path.posix.basename(file.relativePath));
  }
  for (const folder of setupChildFolders(folderId)) {
    const file = created.get(folder.id);
    if (file?.kind === "folder") {
      children.push(path.posix.basename(path.posix.dirname(file.relativePath)));
    }
  }
  return children;
}

/** Root order: repository-root pages first, then the selected area folders. */
function rootChildren(plan: SetupPlan): string[] {
  const created = new Map(
    plan.files
      .filter((file) => file.status === "create" && file.nodeId)
      .map((file) => [file.nodeId!, file])
  );
  const children: string[] = [];
  for (const page of setupChildPages(undefined)) {
    const file = created.get(page.id);
    if (file?.kind === "page") children.push(path.posix.basename(file.relativePath));
  }
  for (const folder of setupChildFolders(undefined)) {
    const file = created.get(folder.id);
    if (file?.kind === "folder") {
      children.push(path.posix.basename(path.posix.dirname(file.relativePath)));
    }
  }
  return children;
}

function projectInformationGuide(plan: SetupPlan): string {
  const ja = plan.language === "ja";
  const bundle = setupPackLocale(plan.language);
  const pages = plan.files.filter(
    (file) =>
      file.kind === "page" && file.status === "create" && file.templateId !== "project-guide"
  );
  const areaLines = AREA_IDS.map((areaId) => {
    const areaPages = pages.filter((file) => file.areaId === areaId);
    if (!areaPages.length) return undefined;
    const rootFolder = plan.folderNames[`area-${areaId}`] ?? areaId;
    return `- ${bundle.areas[areaId]?.title ?? areaId}: \`${rootFolder}\` — ${areaPages
      .map((file) => `[[${file.pageId} | ${file.title}]]`)
      .join(ja ? "、" : ", ")}`;
  }).filter((line): line is string => Boolean(line));
  const omitted = AREA_IDS
    .filter((areaId) => !pages.some((file) => file.areaId === areaId))
    .map((areaId) => bundle.areas[areaId]?.title ?? areaId);
  const folderCount = plan.files.filter(
    (file) => file.kind === "folder" && file.status === "create" && file.folderId
  ).length;

  if (ja) {
    return `## このPageの役割

このPageは、初期セットアップ時点の構成と読み順を人間と外部AIへ案内する入口です。後から構成を追加した場合は、必要に応じて利用者が編集してください。

## 採用した構成

- 規模: ${plan.size ?? "未指定"}
- 開発方式: ${plan.method ?? "未指定"}
- 管理level: ${plan.level ?? "個別選択"}
- 生成Folder数: ${folderCount}
- 生成Page数: ${pages.length}
- Template Pack: \`${SETUP_PACK.id}@${SETUP_PACK.version}\`

## 情報領域とPage

${areaLines.join("\n") || "標準Pageは生成していません。"}

## 読み方

1. プロジェクトの目的と範囲を確認します。
2. 要求と重要な判断を確認します。
3. 作業に必要な設計、品質、リリース、運用のPageだけを確認します。

意図的に生成しなかった領域: ${omitted.join("、") || "なし"}

標準構成はISO/IEC/IEEE 12207、PMBOK、arc42、ADR、C4等を参考にした配置ですが、Vellymはこれらへの準拠、進め方、更新頻度、記載内容を強制・判定しません。

Vellymは本文の意味的な重複や矛盾を自動判定しません。また、Git add、commit、pushを自動実行しません。`;
  }
  return `## Purpose of this Page

This Page is the entry point that explains the initial structure and reading order to people and external AI agents. If the structure changes later, update this Page manually when needed.

## Selected structure

- Size: ${plan.size ?? "not specified"}
- Development method: ${plan.method ?? "not specified"}
- Management level: ${plan.level ?? "manual selection"}
- Folders created: ${folderCount}
- Pages created: ${pages.length}
- Template Pack: \`${SETUP_PACK.id}@${SETUP_PACK.version}\`

## Information areas and Pages

${areaLines.join("\n") || "No standard Pages were created."}

## Reading order

1. Read the project purpose and scope.
2. Read requirements and significant decisions.
3. Read only the design, quality, release, or operations Pages needed for the task.

Intentionally omitted areas: ${omitted.join(", ") || "none"}

The standard layout is informed by ISO/IEC/IEEE 12207, PMBOK, arc42, ADR, and C4, but Vellym never enforces or judges conformance, cadence, or content against them.

Vellym does not infer semantic duplication or contradictions, and it never runs Git add, commit, or push automatically.`;
}

function sourceFor(plan: SetupPlan, file: SetupPlanFile): string {
  if (file.kind === "package-json") return packageJsonSource(plan.projectRoot);
  if (file.kind === "config") return configSource(plan.contentRoot, plan.language);
  if (file.kind === "page") {
    const page = setupPage(file.templateId!)!;
    return pageSource(
      page,
      file.pageId!,
      file.slug!,
      plan.language,
      file.title,
      file.templateId === "project-guide" ? projectInformationGuide(plan) : undefined
    );
  }
  if (!file.folderId) {
    return folderSource(
      plan.language === "ja" ? "文書" : "Documents",
      rootChildren(plan),
      plan.language
    );
  }
  const folder: SetupFolderTemplate = setupFolder(file.folderId)!;
  const text = setupPackLocale(plan.language).folders[file.folderId]!;
  return folderSource(
    text.title,
    childrenForFolder(plan, file.folderId),
    plan.language,
    text.description,
    folder.areaId,
    file.folderId
  );
}

export async function applyProjectSetup(expected: SetupPlan): Promise<void> {
  const current = await planProjectSetup(expected.projectRoot, {
    operation: expected.operation,
    mode: expected.mode,
    size: expected.size,
    method: expected.method,
    level: expected.level,
    selectedTemplateIds: expected.selectedTemplateIds,
    selectedFolderIds: expected.selectedFolderIds,
    conflictResolutions: expected.conflictResolutions,
    contentRoot: expected.contentRoot,
    language: expected.language,
    folderNames: expected.folderNames,
    pageFileNames: expected.pageFileNames,
    pageTitles: expected.pageTitles,
    plannedPageIds: expected.plannedPageIds
  });
  if (current.planHash !== expected.planHash) {
    throw new RuntimeError(
      "preview後に対象が変更されました。もう一度確認してください",
      409,
      "SETUP_PLAN_CONFLICT"
    );
  }
  const conflicts = current.files.filter((file) => file.status === "conflict");
  if (conflicts.length) {
    throw new RuntimeError(
      `既存ファイルと競合しています: ${conflicts.map((file) => file.relativePath).join("、")}`,
      409,
      "SETUP_FILE_CONFLICT"
    );
  }

  const createdCandidates = current.files.filter((file) => file.status === "create");
  const sources = new Map(
    createdCandidates.map((file) => [file.relativePath, sourceFor(current, file)])
  );
  for (const file of createdCandidates) {
    // package.jsonはYAMLでもVellymのリソースでもない。JSONとして読めれば足りる。
    if (file.kind === "package-json") {
      try {
        JSON.parse(sources.get(file.relativePath)!);
      } catch {
        throw new RuntimeError(
          `初期生成JSONの検証に失敗しました: ${file.relativePath}`,
          500,
          "SETUP_VALIDATION"
        );
      }
      continue;
    }
    const document = parseDocument(sources.get(file.relativePath)!);
    const value = document.toJS();
    const valid = file.kind === "page"
      ? Boolean(validatePage(value, file.relativePath).page)
      : file.kind === "folder"
        ? Boolean(validateFolder(value, file.relativePath).folder)
        : Boolean(validateConfig(value, file.relativePath).config);
    if (document.errors.length || !valid) {
      throw new RuntimeError(
        `初期生成YAMLの検証に失敗しました: ${file.relativePath}`,
        500,
        "SETUP_VALIDATION"
      );
    }
  }

  const createdFiles: string[] = [];
  const createdDirectories: string[] = [];
  try {
    const directories = [
      ...new Set(
        createdCandidates.map((file) =>
          path.dirname(path.join(current.projectRoot, file.relativePath))
        )
      )
    ].sort((a, b) => a.length - b.length);
    const ensureDirectory = async (directory: string): Promise<void> => {
      if (await exists(directory)) return;
      const parent = path.dirname(directory);
      if (parent !== directory) await ensureDirectory(parent);
      try {
        await mkdir(directory);
        createdDirectories.push(directory);
      } catch (error) {
        if (!(await exists(directory))) throw error;
      }
    };
    for (const directory of directories) await ensureDirectory(directory);

    // Shallow folders first, then pages, then the config that points at them.
    const rank = (file: SetupPlanFile): number =>
      file.kind === "config" || file.kind === "package-json"
        ? 2
        : file.kind === "folder"
          ? 0
          : 1;
    const ordered = [...createdCandidates].sort((a, b) => {
      const byKind = rank(a) - rank(b);
      if (byKind !== 0) return byKind;
      return a.relativePath.split("/").length - b.relativePath.split("/").length;
    });
    for (const file of ordered) {
      const target = path.join(current.projectRoot, file.relativePath);
      await writeFile(target, sources.get(file.relativePath)!, {
        encoding: "utf8",
        flag: "wx"
      });
      createdFiles.push(target);
    }
    await loadConfig(path.join(current.projectRoot, "vellym.config.yaml"));
  } catch (error) {
    const rollback = await Promise.allSettled(
      createdFiles.map((target) => rm(target, { force: true }))
    );
    for (const directory of createdDirectories.reverse()) {
      try { await rmdir(directory); } catch { /* Preserve non-empty directories. */ }
    }
    const remaining = rollback
      .map((result, index) =>
        result.status === "rejected"
          ? path.relative(current.projectRoot, createdFiles[index]!)
          : undefined
      )
      .filter((item): item is string => Boolean(item));
    if (remaining.length) {
      throw new RuntimeError(
        `初期化に失敗し、作成済みファイルを戻せませんでした: ${remaining.join("、")}`,
        500,
        "SETUP_ROLLBACK"
      );
    }
    throw error;
  }
}
