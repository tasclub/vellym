import { createHash, randomBytes } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { parseDocument, stringify } from "yaml";
import {
  STABLE_API_VERSION,
  SUPPORTED_API_VERSIONS,
  validatePage
} from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { contentHash, isInside } from "./path-utils.js";
import { loadRepository } from "./repository.js";

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

export interface StructureUndoPlan {
  expectedRepositoryHash: string;
  move?: { source: string; destination: string };
  folderMetadata: Array<{ relativePath: string; source?: string }>;
  planHash: string;
}

const PAGE_ID = /^page-[a-f0-9]{24}$/;
const WINDOWS_RESERVED =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const RESERVED_DIRECTORIES = new Set([
  ".git",
  "_archive",
  "coverage",
  "dist",
  "node_modules"
]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError(
      "構成変更の入力が不正です",
      400,
      "STRUCTURE_INPUT"
    );
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  name: string,
  options: { empty?: boolean } = {}
): string {
  if (
    typeof value !== "string" ||
    (!options.empty && !value.trim()) ||
    value.length > 500
  ) {
    throw new RuntimeError(
      `${name}が不正です`,
      400,
      "STRUCTURE_INPUT"
    );
  }
  return value;
}

function relativePath(value: unknown, name: string, allowRoot = true): string {
  const input = text(value, name, { empty: allowRoot });
  if (!input && allowRoot) return "";
  if (
    path.isAbsolute(input) ||
    input.includes("\\") ||
    input.includes("\0") ||
    input.split("/").some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.startsWith(".") ||
        part === "_archive"
    )
  ) {
    throw new RuntimeError(
      `${name}がcontentRoot内の安全な相対pathではありません`,
      400,
      "STRUCTURE_PATH"
    );
  }
  return input.normalize("NFC");
}

// 復元対象は_archive/配下にある。pathは_archiveから見た元の位置
// （例 "guides/setup.yaml" やフォルダ "guides"）を表すため、relativePathと違い
// それ自体に"_archive"セグメントを含んではならず、空でもいけない。
function archiveRelativePath(value: unknown, name: string): string {
  const input = text(value, name);
  if (
    path.isAbsolute(input) ||
    input.includes("\\") ||
    input.includes("\0") ||
    input.split("/").some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.startsWith(".") ||
        part === "_archive"
    )
  ) {
    throw new RuntimeError(
      `${name}が_archive内の安全な相対pathではありません`,
      400,
      "STRUCTURE_PATH"
    );
  }
  return input.normalize("NFC");
}

function orderValue(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !item ||
        item === "." ||
        item === ".." ||
        item === "_index.yaml" ||
        /[\/\\\0]/.test(item)
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new RuntimeError(
      "destinationOrderが不正です",
      400,
      "STRUCTURE_ORDER"
    );
  }
  return value as string[];
}

export function parseStructureInput(value: unknown): StructureInput {
  const candidate = object(value);
  const type = text(candidate.type, "type");
  switch (type) {
    case "create-page": {
      const pageId =
        candidate.pageId === undefined
          ? undefined
          : text(candidate.pageId, "pageId");
      if (pageId !== undefined && !PAGE_ID.test(pageId)) {
        throw new RuntimeError(
          "pageIdが不正です",
          400,
          "STRUCTURE_PAGE_ID"
        );
      }
      const slug = candidate.slug === undefined
        ? undefined
        : text(candidate.slug, "slug").normalize("NFC");
      if (
        slug !== undefined &&
        !/^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u.test(slug)
      ) {
        throw new RuntimeError("URL名が不正です", 400, "STRUCTURE_PAGE_SLUG");
      }
      return {
        type,
        title: text(candidate.title, "title").trim(),
        parentPath: relativePath(candidate.parentPath ?? "", "parentPath"),
        ...(pageId ? { pageId } : {}),
        ...(slug ? { slug } : {})
      };
    }
    case "create-folder":
      return {
        type,
        name: text(candidate.name, "name").trim(),
        parentPath: relativePath(candidate.parentPath ?? "", "parentPath")
      };
    case "update-folder":
      return {
        type,
        folderPath: relativePath(candidate.folderPath, "folderPath"),
        title: text(candidate.title, "title").trim(),
        description: text(candidate.description ?? "", "description", {
          empty: true
        })
      };
    case "move-page":
      return {
        type,
        pageId: text(candidate.pageId, "pageId"),
        destinationPath: relativePath(
          candidate.destinationPath ?? "",
          "destinationPath"
        ),
        ...(candidate.destinationOrder === undefined
          ? {}
          : { destinationOrder: orderValue(candidate.destinationOrder) })
      };
    case "rename-page-file":
      return {
        type,
        pageId: text(candidate.pageId, "pageId"),
        fileName: text(candidate.fileName, "fileName").trim()
      };
    case "move-folder":
      return {
        type,
        folderPath: relativePath(candidate.folderPath, "folderPath", false),
        destinationPath: relativePath(
          candidate.destinationPath ?? "",
          "destinationPath"
        ),
        ...(candidate.destinationOrder === undefined
          ? {}
          : { destinationOrder: orderValue(candidate.destinationOrder) })
      };
    case "reorder": {
      if (
        !Array.isArray(candidate.order) ||
        candidate.order.some(
          (item) =>
            typeof item !== "string" ||
            !item ||
            item === "." ||
            item === ".." ||
            item === "_index.yaml" ||
            /[\/\\\0]/.test(item)
        ) ||
        new Set(candidate.order).size !== candidate.order.length
      ) {
        throw new RuntimeError(
          "orderが不正です",
          400,
          "STRUCTURE_ORDER"
        );
      }
      return {
        type,
        folderPath: relativePath(
          candidate.folderPath ?? "",
          "folderPath"
        ),
        order: candidate.order as string[]
      };
    }
    case "archive-page":
      return {
        type,
        pageId: text(candidate.pageId, "pageId")
      };
    case "archive-folder":
      return {
        type,
        folderPath: relativePath(candidate.folderPath, "folderPath", false)
      };
    case "restore":
      return {
        type,
        archivePath: archiveRelativePath(candidate.archivePath, "archivePath")
      };
    default:
      throw new RuntimeError(
        "未対応の構成変更です",
        400,
        "STRUCTURE_TYPE"
      );
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function safeName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[\/\\\0-\x1f\x7f]/g, "-")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  return !normalized ||
    normalized === "." ||
    normalized === ".." ||
    WINDOWS_RESERVED.test(normalized)
    ? fallback
    : normalized;
}

function safeSlug(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "page";
}

async function unusedFilePath(
  directory: string,
  basename: string
): Promise<string> {
  const entries = await readdir(directory);
  const folded = new Set(entries.map((entry) => entry.toLocaleLowerCase()));
  let candidate = `${basename}.yaml`;
  let suffix = 2;
  while (folded.has(candidate.toLocaleLowerCase())) {
    candidate = `${basename}-${suffix}.yaml`;
    suffix += 1;
  }
  return path.join(directory, candidate);
}

async function hasCaseInsensitiveEntry(
  directory: string,
  basename: string
): Promise<boolean> {
  const folded = basename.toLocaleLowerCase();
  return (await readdir(directory)).some(
    (entry) => entry.toLocaleLowerCase() === folded
  );
}

async function directEntryNames(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        !entry.isSymbolicLink() &&
        entry.name !== "_index.yaml" &&
        !entry.name.startsWith(".") &&
        entry.name !== "_archive"
    )
    .map((entry) => entry.name);
}

function assertExactOrder(order: string[], entries: string[]): void {
  const expected = [...entries].sort();
  const actual = [...order].sort();
  if (
    expected.length !== actual.length ||
    expected.some((item, index) => item !== actual[index])
  ) {
    throw new RuntimeError(
      "destinationOrderは移動後の直接の子をすべて一度ずつ含めてください",
      400,
      "STRUCTURE_ORDER"
    );
  }
}

async function unusedArchivePath(
  contentRoot: string,
  relativeSource: string
): Promise<string> {
  const initial = path.join(contentRoot, "_archive", relativeSource);
  if (!(await exists(initial))) return initial;
  const extension = path.extname(initial);
  const base = extension ? initial.slice(0, -extension.length) : initial;
  let suffix = 2;
  let candidate = `${base}-${suffix}${extension}`;
  while (await exists(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}${extension}`;
  }
  return candidate;
}

async function fingerprint(root: string): Promise<string> {
  const values: string[] = [];
  async function scan(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        values.push(`l:${relative}`);
      } else if (entry.isDirectory()) {
        values.push(`d:${relative}`);
        await scan(target);
      } else if (entry.isFile()) {
        values.push(`f:${relative}:${contentHash(await readFile(target, "utf8"))}`);
      }
    }
  }
  await scan(root);
  return createHash("sha256").update(values.join("\n")).digest("hex");
}

async function assertSafeDirectory(
  contentRoot: string,
  folderPath: string
): Promise<string> {
  const rootReal = await realpath(contentRoot);
  const target = path.join(contentRoot, folderPath);
  let targetReal: string;
  try {
    targetReal = await realpath(target);
  } catch {
    throw new RuntimeError(
      "移動先フォルダが見つかりません",
      404,
      "STRUCTURE_FOLDER_NOT_FOUND"
    );
  }
  if (targetReal !== rootReal && !isInside(rootReal, targetReal)) {
    throw new RuntimeError(
      "contentRoot外は操作できません",
      422,
      "STRUCTURE_BOUNDARY"
    );
  }
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new RuntimeError(
      "通常フォルダ以外は操作できません",
      422,
      "STRUCTURE_UNSAFE"
    );
  }
  return target;
}

function publicPath(contentRoot: string, target: string): string {
  return path.relative(contentRoot, target).replaceAll("\\", "/") || ".";
}

export async function planStructureChange(
  contentRoot: string,
  rawInput: unknown
): Promise<StructurePlan> {
  const input = parseStructureInput(rawInput);
  const snapshot = await loadRepository(contentRoot);
  const changes: StructurePlan["changes"] = [];
  const warnings: string[] = [];
  let affectedPages = 0;
  let conflict: string | undefined;
  let title = "";

  if (input.type === "create-page") {
    const parent = await assertSafeDirectory(contentRoot, input.parentPath);
    let pageId = input.pageId;
    do {
      pageId = pageId ?? `page-${randomBytes(12).toString("hex")}`;
      if (!snapshot.byName.has(pageId)) break;
      pageId = undefined;
    } while (true);
    input.pageId = pageId;
    let slug = input.slug ?? safeSlug(input.title);
    let slugSuffix = 2;
    while (
      snapshot.bySlug.has(slug.toLocaleLowerCase()) ||
      [...snapshot.pages].some(
        (page) =>
          (page.view.page.metadata.slug ?? page.view.page.metadata.name)
            .toLocaleLowerCase() === slug.toLocaleLowerCase()
      )
    ) {
      slug = `${safeSlug(input.title)}-${slugSuffix++}`;
    }
    input.slug = slug;
    const candidateName = safeName(input.title, pageId);
    const basename =
      candidateName.toLocaleLowerCase() === "_index"
        ? pageId
        : candidateName;
    const target = await unusedFilePath(parent, basename);
    title = `ページ「${input.title}」を作成`;
    changes.push({ operation: "create", destination: publicPath(contentRoot, target) });
    affectedPages = 1;
  } else if (input.type === "create-folder") {
    const parent = await assertSafeDirectory(contentRoot, input.parentPath);
    const basename = safeName(input.name, "folder");
    const target = path.join(parent, basename);
    title = `フォルダ「${input.name}」を作成`;
    if (RESERVED_DIRECTORIES.has(basename.toLocaleLowerCase())) {
      conflict = "製品が使用する予約名のため作成できません";
    } else if (await hasCaseInsensitiveEntry(parent, basename)) {
      conflict = "大文字小文字だけが異なる項目を含め、同名の項目が既に存在します";
    }
    changes.push({ operation: "create", destination: publicPath(contentRoot, target) });
  } else if (input.type === "update-folder") {
    await assertSafeDirectory(contentRoot, input.folderPath);
    const folder = snapshot.folders.find((item) => item.path === input.folderPath);
    if (!folder) {
      throw new RuntimeError(
        "フォルダが見つかりません",
        404,
        "STRUCTURE_FOLDER_NOT_FOUND"
      );
    }
    if (folder.readOnly) {
      throw new RuntimeError(
        folder.readOnlyReasons.join("、"),
        422,
        "STRUCTURE_READ_ONLY"
      );
    }
    const index = path.join(contentRoot, input.folderPath, "_index.yaml");
    title = `フォルダ「${folder.title}」の表示情報を更新`;
    changes.push({ operation: "update", destination: publicPath(contentRoot, index) });
  } else if (input.type === "rename-page-file") {
    const loaded = snapshot.byName.get(input.pageId);
    if (!loaded) throw new RuntimeError("Pageが見つかりません", 404, "NOT_FOUND");
    const directory = path.dirname(loaded.sourcePath);
    const requested = input.fileName.replace(/\.ya?ml$/i, "");
    const basename = safeName(requested, input.pageId);
    if (basename.toLocaleLowerCase() === "_index") {
      conflict = "_index.yamlはFolder metadataの予約名です";
    }
    const target = path.join(directory, `${basename}.yaml`);
    title = `ページ「${loaded.view.page.metadata.title}」のファイル名を変更`;
    if (loaded.sourcePath === target) {
      conflict = "現在と同じファイル名です";
    } else if (await hasCaseInsensitiveEntry(directory, path.basename(target))) {
      conflict = "同名のファイルがあります";
    }
    changes.push({
      operation: "move",
      source: loaded.view.relativePath,
      destination: publicPath(contentRoot, target)
    });
    affectedPages = 1;
  } else if (input.type === "move-page") {
    const loaded = snapshot.byName.get(input.pageId);
    if (!loaded) throw new RuntimeError("Pageが見つかりません", 404, "NOT_FOUND");
    const destination = await assertSafeDirectory(
      contentRoot,
      input.destinationPath
    );
    const target = path.join(destination, path.basename(loaded.sourcePath));
    if (input.destinationOrder) {
      const entries = await directEntryNames(destination);
      assertExactOrder(input.destinationOrder, [
        ...entries.filter((entry) => entry !== path.basename(loaded.sourcePath)),
        path.basename(loaded.sourcePath)
      ]);
    }
    title = `ページ「${loaded.view.page.metadata.title}」を移動`;
    if (loaded.sourcePath === target) conflict = "既に選択したフォルダにあります";
    else if (
      await hasCaseInsensitiveEntry(destination, path.basename(target))
    ) {
      conflict = "移動先に同名ファイルがあります";
    }
    changes.push({
      operation: "move",
      source: loaded.view.relativePath,
      destination: publicPath(contentRoot, target)
    });
    affectedPages = 1;
  } else if (input.type === "move-folder") {
    const source = await assertSafeDirectory(contentRoot, input.folderPath);
    const destination = await assertSafeDirectory(
      contentRoot,
      input.destinationPath
    );
    if (
      destination === source ||
      isInside(source, destination)
    ) {
      throw new RuntimeError(
        "フォルダ自身または配下へ移動できません",
        400,
        "STRUCTURE_MOVE_CYCLE"
      );
    }
    const target = path.join(destination, path.basename(source));
    if (input.destinationOrder) {
      const entries = await directEntryNames(destination);
      assertExactOrder(input.destinationOrder, [
        ...entries.filter((entry) => entry !== path.basename(source)),
        path.basename(source)
      ]);
    }
    title = `フォルダ「${path.basename(source)}」を移動`;
    if (path.dirname(source) === destination) {
      conflict = "既に選択したフォルダにあります";
    } else if (
      await hasCaseInsensitiveEntry(destination, path.basename(target))
    ) {
      conflict = "移動先に同名フォルダがあります";
    }
    affectedPages = snapshot.pages.filter((page) =>
      page.view.relativePath.startsWith(`${input.folderPath}/`)
    ).length;
    if ((await readdir(source)).length > 0) {
      warnings.push("空でないフォルダです。配下の内容も一緒に移動します");
    }
    if (affectedPages > 0) warnings.push(`配下の${affectedPages}ページも移動します`);
    changes.push({
      operation: "move",
      source: input.folderPath,
      destination: publicPath(contentRoot, target)
    });
  } else if (input.type === "reorder") {
    const folderDirectory = await assertSafeDirectory(
      contentRoot,
      input.folderPath
    );
    const entries = (await readdir(folderDirectory, { withFileTypes: true }))
      .filter(
        (entry) =>
          !entry.isSymbolicLink() &&
          entry.name !== "_index.yaml" &&
          !entry.name.startsWith(".") &&
          entry.name !== "_archive"
      )
      .map((entry) => entry.name);
    const missing = input.order.filter((item) => !entries.includes(item));
    if (missing.length) {
      throw new RuntimeError(
        `存在しない項目がorderに含まれます: ${missing.join("、")}`,
        400,
        "STRUCTURE_ORDER"
      );
    }
    title = "同じフォルダ内の表示順を更新";
    changes.push({
      operation: "update",
      destination: publicPath(contentRoot, path.join(folderDirectory, "_index.yaml"))
    });
  } else if (input.type === "restore") {
    // アーカイブ済みエントリを元の位置へ戻す。アーカイブpathは元のpathを写した
    // ものなので、復元先はarchivePathそのもの。元の親フォルダが無い場合は親を
    // 作り直さず失敗させ、復元の挙動を予測可能に保つ。
    const archiveRoot = path.join(contentRoot, "_archive");
    const source = path.join(archiveRoot, input.archivePath);
    const info = await lstat(source).catch(() => undefined);
    if (!info) {
      throw new RuntimeError(
        "アーカイブ項目が見つかりません",
        404,
        "STRUCTURE_ARCHIVE_NOT_FOUND"
      );
    }
    const isFolder = info.isDirectory();
    const target = path.join(contentRoot, input.archivePath);
    const parent = path.dirname(target);
    const basename = path.basename(target);
    title = isFolder
      ? `フォルダ「${basename}」を復元`
      : `ページ「${await archivedTitle(source, basename)}」を復元`;
    affectedPages = isFolder
      ? (await archivedYamlCount(source))
      : 1;
    if (isFolder && affectedPages > 0) {
      warnings.push(`配下の${affectedPages}ページも復元します`);
    }
    if (!(await exists(parent))) {
      conflict = "復元先の親フォルダがありません。先に親フォルダを作成してください";
    } else if (await hasCaseInsensitiveEntry(parent, basename)) {
      conflict = "復元先に同名の項目があります";
    }
    changes.push({
      operation: "restore",
      source: publicPath(contentRoot, source),
      destination: publicPath(contentRoot, target)
    });
  } else {
    const isPage = input.type === "archive-page";
    const loaded = isPage ? snapshot.byName.get(input.pageId) : undefined;
    if (isPage && !loaded) {
      throw new RuntimeError("Pageが見つかりません", 404, "NOT_FOUND");
    }
    const source = isPage
      ? loaded!.sourcePath
      : await assertSafeDirectory(contentRoot, input.folderPath);
    const relativeSource = publicPath(contentRoot, source);
    const target = await unusedArchivePath(contentRoot, relativeSource);
    title = isPage
      ? `ページ「${loaded!.view.page.metadata.title}」をアーカイブ`
      : `フォルダ「${path.basename(source)}」をアーカイブ`;
    affectedPages = isPage
      ? 1
      : snapshot.pages.filter((page) =>
          page.view.relativePath.startsWith(`${input.folderPath}/`)
        ).length;
    if (!isPage && affectedPages > 0) {
      warnings.push(`配下の${affectedPages}ページもアーカイブします`);
    }
    if (!isPage && (await readdir(source)).length > 0) {
      warnings.push("空でないフォルダです。配下の内容も一緒にアーカイブします");
    }
    warnings.push("アーカイブした項目は設定画面の「アーカイブ済み」から復元できます");
    changes.push({
      operation: "archive",
      source: relativeSource,
      destination: publicPath(contentRoot, target)
    });
  }

  const repositoryHash = await fingerprint(contentRoot);
  const planHash = createHash("sha256")
    .update(JSON.stringify({ input, changes, repositoryHash, conflict }))
    .digest("hex");
  return {
    input,
    title,
    changes,
    warnings,
    affectedPages,
    executable: !conflict,
    ...(conflict ? { conflict } : {}),
    planHash
  };
}

function pageSource(pageId: string, slug: string, title: string): string {
  return stringify(
    {
      apiVersion: STABLE_API_VERSION,
      kind: "Page",
      metadata: { name: pageId, slug, title },
      spec: {
        blocks: [
          {
            id: "body",
            type: "rich-text",
            format: "commonmark",
            content: ""
          }
        ]
      }
    },
    { lineWidth: 0 }
  );
}

async function writeFolderMetadata(
  directory: string,
  change:
    | { title: string; description: string }
    | { order: string[] }
): Promise<void> {
  const indexPath = path.join(directory, "_index.yaml");
  let source: string | undefined;
  try {
    source = await readFile(indexPath, "utf8");
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) throw error;
  }
  const document = source
    ? parseDocument(source, { keepSourceTokens: true })
    : parseDocument(
        stringify({
          apiVersion: STABLE_API_VERSION,
          kind: "Folder",
          metadata: { title: path.basename(directory) || "文書" },
          spec: {}
        })
      );
  if (document.errors.length) {
    throw new RuntimeError(
      document.errors[0]!.message,
      422,
      "FOLDER_METADATA"
    );
  }
  if ("title" in change) {
    document.setIn(["metadata", "title"], change.title);
    if (change.description) {
      document.setIn(["spec", "description"], change.description);
    } else {
      document.deleteIn(["spec", "description"]);
    }
  } else {
    document.setIn(["spec", "order"], change.order);
  }
  const output = document.toString({ lineWidth: 0 });
  const temporary = path.join(
    directory,
    `._index.yaml.vellym-${process.pid}-${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await writeFile(temporary, output, { encoding: "utf8", flag: "wx" });
    const checked = parseDocument(await readFile(temporary, "utf8"));
    const value = checked.toJS() as Record<string, unknown>;
    if (
      checked.errors.length ||
      !SUPPORTED_API_VERSIONS.some((version) => version === value.apiVersion) ||
      value.kind !== "Folder"
    ) {
      throw new RuntimeError(
        "Folder metadataの検証に失敗しました",
        422,
        "FOLDER_VALIDATION"
      );
    }
    await rename(temporary, indexPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function optionalSource(target: string): Promise<string | undefined> {
  return (await exists(target)) ? readFile(target, "utf8") : undefined;
}

// アーカイブされたページ・フォルダはtitleをmetadata.title（フォルダは_index.yaml）へ
// 保持する。無ければファイル／フォルダ名にフォールバックする。
async function archivedTitle(
  entry: string,
  fallbackBasename: string
): Promise<string> {
  const info = await lstat(entry).catch(() => undefined);
  const yamlPath = info?.isDirectory() ? path.join(entry, "_index.yaml") : entry;
  const raw = await optionalSource(yamlPath);
  const fallback = fallbackBasename.replace(/\.ya?ml$/i, "");
  if (!raw) return fallback;
  const document = parseDocument(raw);
  if (document.errors.length) return fallback;
  const value = document.toJS() as { metadata?: { title?: unknown } };
  return typeof value.metadata?.title === "string" && value.metadata.title.trim()
    ? value.metadata.title
    : fallback;
}

async function archivedYamlCount(directory: string): Promise<number> {
  let count = 0;
  for (const dirent of await readdir(directory, { withFileTypes: true })) {
    if (dirent.isSymbolicLink()) continue;
    const full = path.join(directory, dirent.name);
    if (dirent.isDirectory()) {
      count += await archivedYamlCount(full);
    } else if (
      dirent.isFile() &&
      /\.ya?ml$/i.test(dirent.name) &&
      dirent.name !== "_index.yaml"
    ) {
      count += 1;
    }
  }
  return count;
}

export interface ArchivedEntry {
  /** _archive/からの相対path。復元先でもある。 */
  archivePath: string;
  type: "page" | "folder";
  title: string;
}

// _archive/配下の復元可能なエントリを列挙する。元のlive pathがまだ存在する
// ディレクトリは、アーカイブ済みページを入れる単なる入れ物なので中へ再帰する。
// live側が消えているディレクトリはフォルダごとアーカイブされたものとして1エントリで扱う。
export async function listArchived(
  contentRoot: string
): Promise<ArchivedEntry[]> {
  const archiveRoot = path.join(contentRoot, "_archive");
  if (!(await exists(archiveRoot))) return [];
  const entries: ArchivedEntry[] = [];
  async function walk(directory: string): Promise<void> {
    for (const dirent of await readdir(directory, { withFileTypes: true })) {
      if (dirent.isSymbolicLink() || dirent.name.startsWith(".")) continue;
      const full = path.join(directory, dirent.name);
      const rel = path.relative(archiveRoot, full).replaceAll("\\", "/");
      if (dirent.isDirectory()) {
        if (await exists(path.join(contentRoot, rel))) {
          await walk(full);
        } else {
          entries.push({
            archivePath: rel,
            type: "folder",
            title: await archivedTitle(full, dirent.name)
          });
        }
      } else if (
        dirent.isFile() &&
        /\.ya?ml$/i.test(dirent.name) &&
        dirent.name !== "_index.yaml"
      ) {
        entries.push({
          archivePath: rel,
          type: "page",
          title: await archivedTitle(full, dirent.name)
        });
      }
    }
  }
  await walk(archiveRoot);
  entries.sort((left, right) => left.title.localeCompare(right.title, "ja"));
  return entries;
}

async function restoreFolderMetadata(
  snapshots: Array<{ path: string; source?: string }>
): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.source === undefined) {
      await rm(snapshot.path, { force: true });
    } else {
      await writeFile(snapshot.path, snapshot.source, "utf8");
    }
  }
}

async function currentFolderOrder(directory: string): Promise<string[]> {
  const indexPath = path.join(directory, "_index.yaml");
  const source = await optionalSource(indexPath);
  if (!source) return [];
  const document = parseDocument(source);
  if (document.errors.length) return [];
  const value = document.toJS() as {
    spec?: { order?: unknown };
  };
  return Array.isArray(value.spec?.order) &&
    value.spec.order.every((item) => typeof item === "string")
    ? value.spec.order as string[]
    : [];
}

async function normalizeFolderOrder(
  directory: string,
  options: { append?: string; exact?: string[] } = {}
): Promise<void> {
  const entries = await directEntryNames(directory);
  if (options.exact) {
    assertExactOrder(options.exact, entries);
    await writeFolderMetadata(directory, { order: options.exact });
    return;
  }
  const previous = await currentFolderOrder(directory);
  const specified = previous.filter(
    (item) => entries.includes(item) && item !== options.append
  );
  const remaining = entries
    .filter((item) => !specified.includes(item) && item !== options.append)
    .sort((left, right) => left.localeCompare(right, "ja", {
      numeric: true,
      sensitivity: "base"
    }));
  await writeFolderMetadata(directory, {
    order: [
      ...specified,
      ...remaining,
      ...(options.append && entries.includes(options.append)
        ? [options.append]
        : [])
    ]
  });
}

function undoHash(value: Omit<StructureUndoPlan, "planHash">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function applyStructureChange(
  contentRoot: string,
  expected: StructurePlan
): Promise<{ undoPlan?: StructureUndoPlan }> {
  const current = await planStructureChange(contentRoot, expected.input);
  if (current.planHash !== expected.planHash) {
    throw new RuntimeError(
      "preview後に構成が変更されました。もう一度確認してください",
      409,
      "STRUCTURE_PLAN_CONFLICT"
    );
  }
  if (!current.executable) {
    throw new RuntimeError(
      current.conflict ?? "構成変更を適用できません",
      409,
      "STRUCTURE_CONFLICT"
    );
  }
  const change = current.changes[0]!;
  const target = path.join(contentRoot, change.destination === "." ? "" : change.destination);
  const source = change.source ? path.join(contentRoot, change.source) : undefined;
  const metadataDirectories = new Set<string>();
  if (
    current.input.type === "create-page" ||
    current.input.type === "create-folder"
  ) {
    metadataDirectories.add(path.dirname(target));
  } else if (
    current.input.type === "move-page" ||
    current.input.type === "move-folder" ||
    current.input.type === "rename-page-file"
  ) {
    if (source) metadataDirectories.add(path.dirname(source));
    metadataDirectories.add(path.dirname(target));
  } else if (
    current.input.type === "archive-page" ||
    current.input.type === "archive-folder"
  ) {
    if (source) metadataDirectories.add(path.dirname(source));
  } else if (current.input.type === "restore") {
    // 復元では復元先フォルダのorderだけを書き換える。sourceは_archive/配下に
    // あり、orderメタデータを持たない。
    metadataDirectories.add(path.dirname(target));
  } else if (current.input.type === "reorder") {
    metadataDirectories.add(path.dirname(target));
  }
  const metadataSnapshots = await Promise.all(
    [...metadataDirectories].map(async (directory) => {
      const indexPath = path.join(directory, "_index.yaml");
      return {
        path: indexPath,
        source: await optionalSource(indexPath)
      };
    })
  );
  let rollback: (() => Promise<void>) | undefined;
  try {
    if (current.input.type === "create-page") {
      const output = pageSource(
        current.input.pageId!,
        current.input.slug!,
        current.input.title
      );
      const checked = validatePage(
        parseDocument(output).toJS(),
        change.destination
      );
      if (!checked.page) {
        throw new RuntimeError(
          "作成するPageの検証に失敗しました",
          422,
          "STRUCTURE_PAGE_VALIDATION"
        );
      }
      await writeFile(target, output, { encoding: "utf8", flag: "wx" });
      rollback = () => rm(target, { force: true });
      await normalizeFolderOrder(path.dirname(target), {
        append: path.basename(target)
      });
    } else if (current.input.type === "create-folder") {
      await mkdir(target);
      rollback = () => rmdir(target);
      await normalizeFolderOrder(path.dirname(target), {
        append: path.basename(target)
      });
    } else if (current.input.type === "update-folder") {
      const indexPath = target;
      const previous = (await exists(indexPath))
        ? await readFile(indexPath, "utf8")
        : undefined;
      await writeFolderMetadata(path.dirname(indexPath), {
        title: current.input.title,
        description: current.input.description
      });
      rollback = async () => {
        if (previous === undefined) await rm(indexPath, { force: true });
        else await writeFile(indexPath, previous, "utf8");
      };
    } else if (current.input.type === "reorder") {
      const indexPath = target;
      const previous = (await exists(indexPath))
        ? await readFile(indexPath, "utf8")
        : undefined;
      await writeFolderMetadata(path.dirname(indexPath), {
        order: current.input.order
      });
      rollback = async () => {
        if (previous === undefined) await rm(indexPath, { force: true });
        else await writeFile(indexPath, previous, "utf8");
      };
    } else {
      if (!source) throw new Error("source is required");
      const sourceInfo = await lstat(source);
      if (sourceInfo.isSymbolicLink()) {
        throw new RuntimeError(
          "symlinkは移動またはアーカイブできません",
          422,
          "STRUCTURE_UNSAFE"
        );
      }
      if (change.operation === "archive") {
        await mkdir(path.dirname(target), { recursive: true });
      }
      await rename(source, target);
      rollback = () => rename(target, source);
      if (current.input.type === "move-page" ||
          current.input.type === "move-folder") {
        const sourceDirectory = path.dirname(source);
        const targetDirectory = path.dirname(target);
        if (sourceDirectory !== targetDirectory) {
          await normalizeFolderOrder(sourceDirectory);
        }
        await normalizeFolderOrder(targetDirectory, {
          ...(current.input.destinationOrder
            ? { exact: current.input.destinationOrder }
            : { append: path.basename(target) })
        });
      } else if (
        current.input.type === "rename-page-file" ||
        current.input.type === "restore"
      ) {
        // 復元・改名したエントリを復元先フォルダのorder末尾へ追加する。
        // 復元時のsourceは_archive/配下なので正規化しない。
        await normalizeFolderOrder(path.dirname(target), {
          append: path.basename(target)
        });
      } else {
        await normalizeFolderOrder(path.dirname(source));
      }
    }
    await loadRepository(contentRoot);
    const undoable =
      current.input.type === "move-page" ||
      current.input.type === "move-folder" ||
      current.input.type === "reorder";
    if (!undoable) return {};
    const undoBase: Omit<StructureUndoPlan, "planHash"> = {
      expectedRepositoryHash: await fingerprint(contentRoot),
      ...(current.input.type === "move-page" ||
          current.input.type === "move-folder"
        ? {
            move: {
              source: change.destination,
              destination: change.source!
            }
          }
        : {}),
      folderMetadata: metadataSnapshots.map((snapshot) => ({
        relativePath: publicPath(contentRoot, snapshot.path),
        ...(snapshot.source === undefined ? {} : { source: snapshot.source })
      }))
    };
    return {
      undoPlan: { ...undoBase, planHash: undoHash(undoBase) }
    };
  } catch (error) {
    if (rollback) {
      try {
        await rollback();
        await restoreFolderMetadata(metadataSnapshots);
      } catch {
        throw new RuntimeError(
          "構成変更に失敗し、元の状態へ戻せませんでした",
          500,
          "STRUCTURE_ROLLBACK"
        );
      }
    }
    throw error;
  }
}

function safeUndoPath(contentRoot: string, relative: string): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new RuntimeError("undo pathが不正です", 400, "STRUCTURE_UNDO");
  }
  const target = path.resolve(contentRoot, relative);
  const root = path.resolve(contentRoot);
  if (!isInside(root, target)) {
    throw new RuntimeError("contentRoot外はundoできません", 422, "STRUCTURE_BOUNDARY");
  }
  return target;
}

export async function applyStructureUndo(
  contentRoot: string,
  expected: StructureUndoPlan
): Promise<void> {
  const { planHash, ...base } = expected;
  if (
    typeof planHash !== "string" ||
    planHash !== undoHash(base) ||
    typeof expected.expectedRepositoryHash !== "string" ||
    !Array.isArray(expected.folderMetadata)
  ) {
    throw new RuntimeError("undo planが不正です", 400, "STRUCTURE_UNDO");
  }
  if (await fingerprint(contentRoot) !== expected.expectedRepositoryHash) {
    throw new RuntimeError(
      "構成変更後に外部変更がありました。元に戻せないため、最新の文書ツリーを確認してください",
      409,
      "STRUCTURE_UNDO_CONFLICT"
    );
  }
  const metadata = expected.folderMetadata.map((item) => {
    const target = safeUndoPath(contentRoot, item.relativePath);
    if (path.basename(target) !== "_index.yaml") {
      throw new RuntimeError("undo metadata pathが不正です", 400, "STRUCTURE_UNDO");
    }
    return { path: target, source: item.source };
  });
  const currentMetadata = await Promise.all(
    metadata.map(async (item) => ({
      path: item.path,
      source: await optionalSource(item.path)
    }))
  );
  const move = expected.move
    ? {
        source: safeUndoPath(contentRoot, expected.move.source),
        destination: safeUndoPath(contentRoot, expected.move.destination)
      }
    : undefined;
  let moved = false;
  try {
    if (move) {
      if (await exists(move.destination)) {
        throw new RuntimeError(
          "元の場所に同名の項目があるため元に戻せません",
          409,
          "STRUCTURE_UNDO_CONFLICT"
        );
      }
      await rename(move.source, move.destination);
      moved = true;
    }
    await restoreFolderMetadata(metadata);
    await loadRepository(contentRoot);
  } catch (error) {
    try {
      await restoreFolderMetadata(currentMetadata);
      if (moved && move) await rename(move.destination, move.source);
    } catch {
      throw new RuntimeError(
        "undoに失敗し、適用後の状態へ戻せませんでした",
        500,
        "STRUCTURE_ROLLBACK"
      );
    }
    throw error;
  }
}
