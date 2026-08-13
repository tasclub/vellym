import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  isAlias,
  isNode,
  parseAllDocuments,
  visit,
  type Document
} from "yaml";
import {
  isVellymCandidate,
  knownRichTextBlocks,
  knownRichTextBlocksFrom,
  projectFolder,
  projectPage,
  publishedPageLocales,
  searchPages,
  validateFolder,
  validatePage,
  type Diagnostic,
  type FolderSummary,
  type FolderEditView,
  type PageEditView,
  type PageView,
  type PageSummary
} from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { contentHash } from "./path-utils.js";
import { folderLocaleHashes, pageLocaleHashes } from "./locale-hash.js";
import type {
  LoadedPage,
  RepositorySnapshot
} from "./types.js";

const ignoredDirectories = new Set([
  ".git",
  "_archive",
  "node_modules",
  "dist",
  "coverage"
]);

async function findRepositoryEntries(root: string): Promise<{
  files: string[];
  directories: string[];
}> {
  const files: string[] = [];
  const directories: string[] = [root];
  async function visitDirectory(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          directories.push(target);
          await visitDirectory(target);
        }
      } else if (
        entry.isFile() &&
        /\.ya?ml$/i.test(entry.name) &&
        entry.name !== "_index.yaml"
      ) {
        files.push(target);
      }
    }
  }
  await visitDirectory(root);
  return { files, directories };
}

function folderDiagnostic(
  file: string,
  code: string,
  message: string
): Diagnostic {
  return { file, severity: "error", code, message };
}

async function loadFolderSummaries(
  contentRoot: string,
  directories: string[],
  diagnostics: Diagnostic[]
): Promise<{
  summaries: FolderSummary[];
  resources: RepositorySnapshot["folderResources"];
}> {
  const summaries: FolderSummary[] = [];
  const resources: RepositorySnapshot["folderResources"] = new Map();
  for (const directory of directories) {
    const relative = path.relative(contentRoot, directory).replaceAll("\\", "/");
    const name = relative ? path.basename(directory) : "";
    const fallbackTitle = name || "文書";
    const indexPath = path.join(directory, "_index.yaml");
    const relativeIndex = relative ? `${relative}/_index.yaml` : "_index.yaml";
    let title = fallbackTitle;
    let description: string | undefined;
    let order: string[] = [];
    let readOnly = false;
    let folderHash: string | undefined;
    let folderResource: import("@vellym-internal/core").Folder | undefined;
    const readOnlyReasons: string[] = [];
    try {
      const source = await readFile(indexPath, "utf8");
      folderHash = contentHash(source);
      const documents = parseAllDocuments(source, { keepSourceTokens: true });
      const first = documents[0];
      if (!first || first.errors.length || documents.length !== 1) {
        throw new Error(
          first?.errors[0]?.message ?? "単一YAML documentではありません"
        );
      }
      const value = first.toJS({ maxAliasCount: 100 });
      const validated = validateFolder(value, relativeIndex);
      diagnostics.push(...validated.diagnostics);
      if (!validated.folder) throw new Error("Folder resourceの必須項目が不正です");
      const folder = validated.folder;
      folderResource = folder;
      const spec = folder.spec;
      title = folder.metadata.title;
      if (spec.description !== undefined) {
        if (typeof spec.description !== "string") {
          throw new Error("spec.descriptionは文字列で指定してください");
        }
        description = spec.description;
      }
      if (spec.order !== undefined) {
        if (
          !Array.isArray(spec.order) ||
          spec.order.some(
            (item) =>
              typeof item !== "string" ||
              !item ||
              item === "." ||
              item === ".." ||
              item === "_index.yaml" ||
              /[\/\\\0]/.test(item)
          ) ||
          new Set(spec.order).size !== spec.order.length
        ) {
          throw new Error("spec.orderが不正です");
        }
        order = spec.order as string[];
      }
      const unsafeReasons = unsafeYamlReasons(first, documents.length);
      if (unsafeReasons.length) {
        readOnly = true;
        readOnlyReasons.push(...unsafeReasons);
      }
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
      ) {
        readOnly = true;
        const message = error instanceof Error ? error.message : String(error);
        readOnlyReasons.push(message);
        diagnostics.push(
          folderDiagnostic(relativeIndex, "FOLDER_METADATA", message)
        );
      }
    }
    const summary: FolderSummary = {
      path: relative,
      name,
      title,
      ...(description === undefined ? {} : { description }),
      order,
      readOnly,
      readOnlyReasons,
      ...(folderHash ? { hash: folderHash } : {})
    };
    summaries.push(summary);
    if (folderResource) {
      resources.set(relative, {
        resource: folderResource,
        sourcePath: indexPath,
        summary,
        hash: folderHash!
      });
    }
  }
  return { summaries, resources };
}

function unsafeYamlReasons(document: Document.Parsed, documentCount: number): string[] {
  const reasons = new Set<string>();
  if (documentCount !== 1) reasons.add("複数YAML documentを含むため編集できません");
  visit(document, (_key, node) => {
    if (isAlias(node)) reasons.add("aliasを含むため編集できません");
    if (isNode(node)) {
      const annotated = node as typeof node & { anchor?: string; tag?: string };
      if (annotated.anchor) reasons.add("anchorを含むため編集できません");
      if (annotated.tag && !annotated.tag.startsWith("tag:yaml.org,2002:")) {
        reasons.add("custom tagを含むため編集できません");
      }
    }
  });
  return [...reasons];
}

async function assertContentRoot(contentRoot: string): Promise<void> {
  try {
    const info = await stat(contentRoot);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new RuntimeError(
      `contentRootが見つからないかディレクトリではありません: ${contentRoot}`,
      400,
      "CONTENT_ROOT_NOT_FOUND"
    );
  }
}

export async function loadRepository(contentRoot: string): Promise<RepositorySnapshot> {
  await assertContentRoot(contentRoot);
  const { files, directories } = await findRepositoryEntries(contentRoot);
  const pages: LoadedPage[] = [];
  const diagnostics: Diagnostic[] = [];
  const loadedFolders = await loadFolderSummaries(
    contentRoot,
    directories,
    diagnostics
  );
  const folders = loadedFolders.summaries;

  for (const sourcePath of files) {
    const relativePath = path.relative(contentRoot, sourcePath);
    let source: string;
    try {
      source = await readFile(sourcePath, "utf8");
    } catch (error) {
      diagnostics.push({
        file: relativePath,
        severity: "error",
        code: "READ_ERROR",
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    const documents = parseAllDocuments(source, { keepSourceTokens: true });
    const first = documents[0];
    if (!first) continue;
    if (first.errors.length) {
      diagnostics.push(
        ...first.errors.map((error) => ({
          file: relativePath,
          severity: "error" as const,
          code: "YAML_PARSE",
          message: error.message
        }))
      );
      continue;
    }
    let value: unknown;
    try {
      value = first.toJS({ maxAliasCount: 100 });
    } catch (error) {
      diagnostics.push({
        file: relativePath,
        severity: "error",
        code: "YAML_CONVERSION",
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    if (!isVellymCandidate(value)) continue;
    const validated = validatePage(value, relativePath);
    diagnostics.push(...validated.diagnostics);
    if (!validated.page) continue;
    const known = knownRichTextBlocks(validated.page, relativePath);
    diagnostics.push(...known.diagnostics);
    const reasons = unsafeYamlReasons(first, documents.length);
    pages.push({
      sourcePath,
      view: {
        page: validated.page,
        knownBlocks: known.blocks,
        relativePath,
        hash: contentHash(source),
        readOnly: reasons.length > 0,
        readOnlyReasons: reasons
      }
    });
  }

  const groups = new Map<string, LoadedPage[]>();
  for (const loaded of pages) {
    const current = groups.get(loaded.view.page.metadata.name) ?? [];
    current.push(loaded);
    groups.set(loaded.view.page.metadata.name, current);
  }
  const uniquePages: LoadedPage[] = [];
  for (const [name, group] of groups) {
    if (group.length > 1) {
      for (const loaded of group) {
        loaded.view.readOnly = true;
        loaded.view.readOnlyReasons.push(`Page ID ${name} が重複しています`);
        diagnostics.push({
          file: loaded.view.relativePath,
          path: "/metadata/name",
          severity: "error",
          code: "DUPLICATE_PAGE_ID",
          message: `Page ID ${name} が重複しています`
        });
      }
    }
    uniquePages.push(group[0]!);
  }
  const slugGroups = new Map<string, LoadedPage[]>();
  for (const loaded of uniquePages) {
    const slug = (
      loaded.view.page.metadata.slug ?? loaded.view.page.metadata.name
    ).normalize("NFC").toLocaleLowerCase();
    const current = slugGroups.get(slug) ?? [];
    current.push(loaded);
    slugGroups.set(slug, current);
  }
  for (const [slug, group] of slugGroups) {
    if (group.length < 2) continue;
    for (const loaded of group) {
      loaded.view.readOnly = true;
      loaded.view.readOnlyReasons.push(`URL名 ${slug} が重複しています`);
      diagnostics.push({
        file: loaded.view.relativePath,
        path: "/metadata/slug",
        severity: "error",
        code: "DUPLICATE_PAGE_SLUG",
        message: `URL名 ${slug} が重複しています`
      });
    }
  }
  uniquePages.sort((a, b) => a.view.relativePath.localeCompare(b.view.relativePath));
  for (const folder of folders) {
    if (!folder.order.length) continue;
    const childNames = new Set<string>();
    for (const childFolder of folders) {
      if (!childFolder.path) continue;
      const parent = path.posix.dirname(childFolder.path);
      if ((parent === "." ? "" : parent) === folder.path) {
        childNames.add(path.posix.basename(childFolder.path));
      }
    }
    for (const page of uniquePages) {
      const normalized = page.view.relativePath.replaceAll("\\", "/");
      const parent = path.posix.dirname(normalized);
      if ((parent === "." ? "" : parent) === folder.path) {
        childNames.add(path.posix.basename(normalized));
      }
    }
    for (const item of folder.order) {
      if (childNames.has(item)) continue;
      diagnostics.push({
        file: folder.path ? `${folder.path}/_index.yaml` : "_index.yaml",
        path: "/spec/order",
        severity: "error",
        code: "FOLDER_ORDER_MISSING",
        message: `存在しない子がorderに含まれています: ${item}`
      });
    }
  }
  return {
    pages: uniquePages,
    byName: new Map(uniquePages.map((page) => [page.view.page.metadata.name, page])),
    bySlug: new Map(
      uniquePages.map((page) => [
        (page.view.page.metadata.slug ?? page.view.page.metadata.name)
          .normalize("NFC")
          .toLocaleLowerCase(),
        page
      ])
    ),
    folders,
    folderResources: loadedFolders.resources,
    diagnostics
  };
}

export function pageSummaries(snapshot: RepositorySnapshot): PageSummary[] {
  return snapshot.pages.map(({ view }) => ({
    name: view.page.metadata.name,
    slug: view.page.metadata.slug ?? view.page.metadata.name,
    title: view.page.metadata.title,
    relativePath: view.relativePath,
    readOnly: view.readOnly
  }));
}

export function searchRepository(snapshot: RepositorySnapshot, query: string) {
  return searchPages(snapshot.pages.map(({ view }) => view), query);
}

export function localizedPageSummaries(
  snapshot: RepositorySnapshot,
  locale: string,
  defaultLocale: string
): PageSummary[] {
  return snapshot.pages.flatMap(({ view }) => {
    const requested = projectPage(
      view.page,
      locale,
      defaultLocale,
      view.relativePath
    );
    const projection = requested ?? projectPage(
      view.page,
      resolvePageBaseLocale(view.page, defaultLocale) ?? defaultLocale,
      defaultLocale,
      view.relativePath
    );
    if (!projection) return [];
    return [{
      name: projection.page.metadata.name,
      slug: projection.page.metadata.slug ?? projection.page.metadata.name,
      title: projection.page.metadata.title,
      relativePath: view.relativePath,
      readOnly: view.readOnly,
      locale: projection.locale,
      baseLocale: projection.baseLocale
    }];
  });
}

export function localizedFolderSummaries(
  snapshot: RepositorySnapshot,
  locale: string,
  defaultLocale: string
): FolderSummary[] {
  const visiblePages = localizedPageSummaries(snapshot, locale, defaultLocale);
  const visibleFolderPaths = new Set<string>([""]);
  for (const page of visiblePages) {
    const parts = page.relativePath.replaceAll("\\", "/").split("/").slice(0, -1);
    for (let index = 1; index <= parts.length; index += 1) {
      visibleFolderPaths.add(parts.slice(0, index).join("/"));
    }
  }
  const requestedIsDefault = locale === defaultLocale;
  return snapshot.folders
    .filter((summary) => requestedIsDefault || visibleFolderPaths.has(summary.path))
    .map((summary) => {
    const loaded = snapshot.folderResources.get(summary.path);
    if (!loaded) return summary;
    const projection = projectFolder(
      loaded.resource,
      locale,
      defaultLocale,
      summary.path ? `${summary.path}/_index.yaml` : "_index.yaml"
    );
    if (!projection) return summary;
    return {
      ...summary,
      title: projection.folder.metadata.title,
      locale: projection.locale,
      baseLocale: projection.baseLocale,
      sourceLocale: projection.sourceLocale,
      localeHashes: folderLocaleHashes(loaded.resource, defaultLocale),
      ...(projection.folder.spec.description === undefined
        ? { description: undefined }
        : { description: projection.folder.spec.description })
    };
    });
}

export function localizedPage(
  snapshot: RepositorySnapshot,
  pageId: string,
  locale: string,
  defaultLocale: string
): PageView | undefined {
  const loaded = snapshot.byName.get(pageId);
  if (!loaded) return undefined;
  const baseLocale = resolvePageBaseLocale(loaded.view.page, defaultLocale);
  if (!baseLocale) return undefined;
  const requestedProjection = projectPage(
    loaded.view.page,
    locale,
    defaultLocale,
    loaded.view.relativePath
  );
  const projection = requestedProjection ?? projectPage(
    loaded.view.page,
    baseLocale,
    defaultLocale,
    loaded.view.relativePath
  );
  const validation = validatePage(loaded.view.page, loaded.view.relativePath);
  const availableLocales = publishedPageLocales(
    loaded.view.page,
    defaultLocale,
    loaded.view.relativePath
  );
  if (!projection) return undefined;
  return {
    ...loaded.view,
    page: projection.page,
    knownBlocks: projection.knownBlocks,
    locale: projection.locale,
    requestedLocale: locale,
    baseLocale,
    availableLocales,
    editableLocales: [
      baseLocale,
      ...validation.translations.map(({ locale: item }) => item),
      ...validation.invalidTranslations.flatMap(({ canonicalLocale }) =>
        canonicalLocale ? [canonicalLocale] : []
      )
    ].filter((item, index, all) => all.indexOf(item) === index),
    isBaseLocale: projection.isBaseLocale,
    invalidTranslations: validation.invalidTranslations,
    localeHashes: pageLocaleHashes(loaded.view.page, defaultLocale)
  };
}

export function editablePage(
  snapshot: RepositorySnapshot,
  pageId: string,
  defaultLocale: string
): PageEditView | undefined {
  const loaded = snapshot.byName.get(pageId) ?? snapshot.bySlug.get(pageId);
  if (!loaded) return undefined;
  const validation = validatePage(loaded.view.page, loaded.view.relativePath);
  const baseLocale = resolvePageBaseLocale(loaded.view.page, defaultLocale);
  if (!baseLocale) return undefined;
  const hashes = pageLocaleHashes(loaded.view.page, defaultLocale);
  return {
    pageId: loaded.view.page.metadata.name,
    slug: loaded.view.page.metadata.slug ?? loaded.view.page.metadata.name,
    relativePath: loaded.view.relativePath,
    hash: loaded.view.hash,
    baseLocale,
    locales: [
      {
        locale: baseLocale,
        isBaseLocale: true,
        visibility: "published" as const,
        title: loaded.view.page.metadata.title,
        blocks: knownRichTextBlocks(
          loaded.view.page,
          loaded.view.relativePath
        ).blocks,
        baselineHash: hashes[baseLocale]!
      },
      ...validation.translations.map(({ locale, value, rawKey }) => ({
        locale,
        isBaseLocale: false,
        visibility: value.visibility ?? "published" as const,
        title: value.title,
        blocks: knownRichTextBlocksFrom(
          value.blocks,
          loaded.view.relativePath,
          `/spec/translations/${rawKey}/blocks`
        ).blocks,
        baselineHash: hashes[locale]!
      }))
    ],
    invalidTranslations: validation.invalidTranslations,
    readOnly: loaded.view.readOnly,
    readOnlyReasons: loaded.view.readOnlyReasons
  };
}

export function editableFolder(
  snapshot: RepositorySnapshot,
  folderPath: string,
  defaultLocale: string
): FolderEditView | undefined {
  const summary = snapshot.folders.find(({ path: item }) => item === folderPath);
  if (!summary) return undefined;
  const loaded = snapshot.folderResources.get(folderPath);
  const folder = loaded?.resource ?? {
    apiVersion: "vellym.tasclub.com/v1alpha1",
    kind: "Folder" as const,
    metadata: { title: summary.title },
    spec: summary.description === undefined ? {} : { description: summary.description }
  };
  const validation = validateFolder(folder, folderPath ? `${folderPath}/_index.yaml` : "_index.yaml");
  const baseLocale = resolveDefaultFolderLocale(folder, defaultLocale);
  if (!baseLocale) return undefined;
  const hashes = folderLocaleHashes(folder, defaultLocale);
  return {
    folderPath,
    hash: loaded?.hash ?? null,
    baseLocale,
    locales: [
      {
        locale: baseLocale,
        isBaseLocale: true,
        visibility: "published",
        title: folder.metadata.title,
        ...(folder.spec.description === undefined ? {} : { description: folder.spec.description }),
        baselineHash: hashes[baseLocale]!
      },
      ...validation.translations.map(({ locale, value }) => ({
        locale,
        isBaseLocale: false,
        visibility: value.visibility ?? "published" as const,
        title: value.title,
        ...(value.description === undefined ? {} : { description: value.description }),
        baselineHash: hashes[locale]!
      }))
    ],
    invalidTranslations: validation.invalidTranslations,
    readOnly: summary.readOnly,
    readOnlyReasons: summary.readOnlyReasons
  };
}

function resolveDefaultFolderLocale(
  folder: import("@vellym-internal/core").Folder,
  defaultLocale: string
): string | undefined {
  return projectFolder(folder, folder.spec.locale ?? defaultLocale, defaultLocale)?.baseLocale;
}

function resolvePageBaseLocale(page: PageView["page"], defaultLocale: string) {
  const projection = projectPage(page, page.spec.locale ?? defaultLocale, defaultLocale);
  return projection?.baseLocale;
}

export function localizedSearchRepository(
  snapshot: RepositorySnapshot,
  query: string,
  locale: string,
  defaultLocale: string
) {
  const views = snapshot.pages.flatMap(({ view }) => {
    const localized = localizedPage(
      snapshot,
      view.page.metadata.name,
      locale,
      defaultLocale
    );
    return localized && !("state" in localized) ? [localized] : [];
  });
  return searchPages(views, query);
}
