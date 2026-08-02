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
  SUPPORTED_API_VERSIONS,
  isVellymCandidate,
  knownRichTextBlocks,
  searchPages,
  validatePage,
  type Diagnostic,
  type FolderSummary,
  type PageSummary
} from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { contentHash } from "./path-utils.js";
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
): Promise<FolderSummary[]> {
  const summaries: FolderSummary[] = [];
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
    const readOnlyReasons: string[] = [];
    try {
      const source = await readFile(indexPath, "utf8");
      const documents = parseAllDocuments(source, { keepSourceTokens: true });
      const first = documents[0];
      if (!first || first.errors.length || documents.length !== 1) {
        throw new Error(
          first?.errors[0]?.message ?? "単一YAML documentではありません"
        );
      }
      const value = first.toJS({ maxAliasCount: 100 }) as Record<string, unknown>;
      const metadata =
        value.metadata && typeof value.metadata === "object"
          ? value.metadata as Record<string, unknown>
          : {};
      const spec =
        value.spec && typeof value.spec === "object"
          ? value.spec as Record<string, unknown>
          : {};
      if (
        !SUPPORTED_API_VERSIONS.some((version) => version === value.apiVersion) ||
        value.kind !== "Folder" ||
        typeof metadata.title !== "string" ||
        !metadata.title.trim()
      ) {
        throw new Error("Folder resourceの必須項目が不正です");
      }
      title = metadata.title;
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
    summaries.push({
      path: relative,
      name,
      title,
      ...(description === undefined ? {} : { description }),
      order,
      readOnly,
      readOnlyReasons
    });
  }
  return summaries;
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
  const folders = await loadFolderSummaries(
    contentRoot,
    directories,
    diagnostics
  );

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
