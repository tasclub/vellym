import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { isNode, isPair, parseDocument, stringify, type Document } from "yaml";
import {
  normalizeLocale,
  persistedBaseLocaleForTranslations,
  STABLE_API_VERSION,
  validateFolder,
  type Folder,
  type FolderSummary
} from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { contentHash, isInside } from "./path-utils.js";
import { folderLocaleHashes } from "./locale-hash.js";
import type { FolderLocaleChange, FolderPatch } from "./types.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError("Folder PATCH本文が不正です", 400, "INVALID_FOLDER_PATCH");
  }
  return value as Record<string, unknown>;
}

function folderPath(value: unknown): string {
  if (typeof value !== "string") {
    throw new RuntimeError("folderPathが不正です", 400, "INVALID_FOLDER_PATCH");
  }
  if (
    path.isAbsolute(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some(
      (part) =>
        part === "." ||
        part === ".." ||
        part.startsWith(".") ||
        ["_archive", "coverage", "dist", "node_modules"].includes(part)
    )
  ) {
    throw new RuntimeError("folderPathがcontentRoot内の安全なpathではありません", 400, "FOLDER_PATH");
  }
  return value.normalize("NFC").replace(/^\/+|\/+$/g, "");
}

function locale(value: unknown): string {
  if (typeof value !== "string") {
    throw new RuntimeError("localeが不正です", 400, "INVALID_FOLDER_PATCH");
  }
  const normalized = normalizeLocale(value);
  if (!normalized.valid || !normalized.canonicalInput) {
    throw new RuntimeError("localeはcanonical tagで指定してください", 400, "INVALID_FOLDER_PATCH");
  }
  return normalized.canonical!;
}

function change(value: unknown): FolderLocaleChange {
  const candidate = object(value);
  const targetLocale = locale(candidate.locale);
  if (candidate.operation !== "create" && candidate.operation !== "update") {
    throw new RuntimeError("Folder locale operationが不正です", 400, "INVALID_FOLDER_PATCH");
  }
  const operation = candidate.operation;
  if (
    candidate.baselineHash !== undefined &&
    (typeof candidate.baselineHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.baselineHash))
  ) {
    throw new RuntimeError("baselineHashが不正です", 400, "INVALID_FOLDER_PATCH");
  }
  let initialize: FolderLocaleChange["initialize"];
  if (operation === "create") {
    const raw = object(candidate.initialize);
    if (raw.type === "empty") initialize = { type: "empty" };
    else if (raw.type === "copy") initialize = { type: "copy", sourceLocale: locale(raw.sourceLocale) };
    else throw new RuntimeError("createにはinitializeが必要です", 400, "INVALID_FOLDER_PATCH");
  } else if (candidate.initialize !== undefined) {
    throw new RuntimeError("updateにinitializeは指定できません", 400, "INVALID_FOLDER_PATCH");
  }
  if (operation === "create" && candidate.baselineHash !== undefined) {
    throw new RuntimeError("createにbaselineHashは指定できません", 400, "INVALID_FOLDER_PATCH");
  }
  if (
    candidate.visibility !== undefined &&
    candidate.visibility !== "draft" &&
    candidate.visibility !== "published"
  ) {
    throw new RuntimeError("visibilityが不正です", 400, "INVALID_FOLDER_PATCH");
  }
  if (candidate.title !== undefined && typeof candidate.title !== "string") {
    throw new RuntimeError("titleが不正です", 400, "INVALID_FOLDER_PATCH");
  }
  if (
    candidate.description !== undefined &&
    candidate.description !== null &&
    typeof candidate.description !== "string"
  ) {
    throw new RuntimeError("descriptionが不正です", 400, "INVALID_FOLDER_PATCH");
  }
  return {
    locale: targetLocale,
    operation,
    ...(candidate.baselineHash === undefined
      ? {}
      : { baselineHash: candidate.baselineHash }),
    ...(candidate.visibility === undefined ? {} : { visibility: candidate.visibility }),
    ...(initialize ? { initialize } : {}),
    ...(candidate.title === undefined ? {} : { title: candidate.title }),
    ...(candidate.description === undefined ? {} : { description: candidate.description as string | null })
  };
}

export function parseFolderPatch(value: unknown): FolderPatch {
  const candidate = object(value);
  const baseHash = candidate.baseHash;
  if (baseHash !== null && (typeof baseHash !== "string" || !/^[a-f0-9]{64}$/.test(baseHash))) {
    throw new RuntimeError("baseHashが不正です", 400, "INVALID_FOLDER_PATCH");
  }
  if (!Array.isArray(candidate.localeChanges) || !Array.isArray(candidate.removeLocales)) {
    throw new RuntimeError("localeChangesとremoveLocalesは配列で指定してください", 400, "INVALID_FOLDER_PATCH");
  }
  const localeChanges = candidate.localeChanges.map(change);
  const removeLocales = candidate.removeLocales.map(locale);
  const removeTranslationKeys = candidate.removeTranslationKeys === undefined
    ? []
    : Array.isArray(candidate.removeTranslationKeys)
      ? candidate.removeTranslationKeys.map((key) => {
          if (typeof key !== "string" || !key || key.length > 100 || key.includes("\0") || key === "__proto__") {
            throw new RuntimeError("removeTranslationKeysが不正です", 400, "INVALID_FOLDER_PATCH");
          }
          return key;
        })
      : (() => { throw new RuntimeError("removeTranslationKeysが不正です", 400, "INVALID_FOLDER_PATCH"); })();
  const changed = localeChanges.map(({ locale: item }) => item);
  if (new Set(changed).size !== changed.length || new Set(removeLocales).size !== removeLocales.length) {
    throw new RuntimeError("同じlocaleを複数指定できません", 400, "INVALID_FOLDER_PATCH");
  }
  if (new Set(removeTranslationKeys).size !== removeTranslationKeys.length) {
    throw new RuntimeError("同じtranslation keyを複数指定できません", 400, "INVALID_FOLDER_PATCH");
  }
  if (removeLocales.some((item) => changed.includes(item))) {
    throw new RuntimeError("同じlocaleを変更と削除へ指定できません", 400, "INVALID_FOLDER_PATCH");
  }
  return {
    folderPath: folderPath(candidate.folderPath),
    baseHash,
    localeChanges,
    removeLocales,
    removeTranslationKeys
  };
}

function rawKey(folder: Folder, targetLocale: string): string | undefined {
  const matches = Object.keys(folder.spec.translations ?? {}).filter(
    (key) => normalizeLocale(key).canonical === targetLocale
  );
  if (matches.length > 1) {
    throw new RuntimeError("canonical化後のlocaleが重複しています", 409, "LOCALE_CONFLICT");
  }
  return matches[0];
}

function cloneNode(value: unknown, document: Document.Parsed): unknown {
  return isNode(value) || isPair(value) ? value.clone(document.schema) : value;
}

function validationErrors(value: unknown, file: string): Set<string> {
  return new Set(
    validateFolder(value, file).diagnostics
      .filter(({ severity }) => severity === "error")
      .map(({ code, path: itemPath }) => `${code}:${itemPath ?? "/"}`)
  );
}

function paths(folder: Folder, targetLocale: string, baseLocale: string) {
  if (targetLocale === baseLocale) {
    return {
      title: ["metadata", "title"],
      description: ["spec", "description"]
    };
  }
  const key = rawKey(folder, targetLocale);
  if (!key) return undefined;
  const base = ["spec", "translations", key];
  return {
    title: [...base, "title"],
    description: [...base, "description"],
    visibility: [...base, "visibility"],
    key
  };
}

function create(
  document: Document.Parsed,
  folder: Folder,
  item: FolderLocaleChange,
  baseLocale: string
): void {
  if (item.locale === baseLocale || rawKey(folder, item.locale)) {
    throw new RuntimeError("localeは既に存在します", 409, "LOCALE_ALREADY_EXISTS");
  }
  const target = ["spec", "translations", item.locale];
  if (item.initialize?.type === "empty") {
    document.setIn(
      target,
      document.createNode({ visibility: item.visibility ?? "draft", title: "" })
    );
    return;
  }
  const source = paths(folder, item.initialize!.sourceLocale, baseLocale);
  if (!source) throw new RuntimeError("コピー元localeがありません", 400, "SOURCE_LOCALE_NOT_FOUND");
  if ("key" in source && source.key) {
    document.setIn(
      target,
      cloneNode(document.getIn(["spec", "translations", source.key], true), document)
    );
  } else {
    document.setIn(target, document.createNode({ visibility: "draft", title: "" }));
    document.setIn([...target, "title"], cloneNode(document.getIn(source.title, true), document));
    const description = document.getIn(source.description, true);
    if (description !== undefined) {
      document.setIn([...target, "description"], cloneNode(description, document));
    }
  }
  document.setIn([...target, "visibility"], item.visibility ?? "draft");
}

export async function saveFolder(
  contentRoot: string,
  patch: FolderPatch,
  defaultLocale: string
): Promise<FolderSummary> {
  const rootReal = await realpath(contentRoot);
  const directory = path.resolve(rootReal, patch.folderPath);
  if (!isInside(rootReal, directory) && directory !== rootReal) {
    throw new RuntimeError("contentRoot外のFolderは保存できません", 422, "PATH_BOUNDARY");
  }
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new RuntimeError("通常のFolder以外は保存できません", 422, "UNSAFE_FOLDER");
  }
  const directoryReal = await realpath(directory);
  if (!isInside(rootReal, directoryReal) && directoryReal !== rootReal) {
    throw new RuntimeError("contentRoot外のFolderは保存できません", 422, "PATH_BOUNDARY");
  }
  const indexPath = path.join(directoryReal, "_index.yaml");
  let source: string | undefined;
  let fileMode: number | undefined;
  try {
    source = await readFile(indexPath, "utf8");
    const info = await lstat(indexPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new RuntimeError("通常ファイル以外のFolder metadataは保存できません", 422, "UNSAFE_FILE");
    }
    fileMode = info.mode;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  if ((source ? contentHash(source) : null) !== patch.baseHash) {
    throw new RuntimeError(
      "Folder metadataの外部変更を検出しました",
      409,
      "HASH_CONFLICT",
      "/spec/translations"
    );
  }
  const document = source
    ? parseDocument(source, { keepSourceTokens: true })
    : parseDocument(stringify({
        apiVersion: STABLE_API_VERSION,
        kind: "Folder",
        metadata: { title: path.basename(directoryReal) || "文書" },
        spec: {}
      }));
  if (document.errors.length) throw new RuntimeError(document.errors[0]!.message, 422, "YAML_PARSE");
  const original = document.toJS({ maxAliasCount: 100 }) as Folder;
  const localeHashes = folderLocaleHashes(original, defaultLocale);
  for (const item of patch.localeChanges) {
    if (
      item.operation === "update" &&
      item.baselineHash !== undefined &&
      localeHashes[item.locale] !== item.baselineHash
    ) {
      throw new RuntimeError(
        `Folder locale ${item.locale} の編集開始後に内容が変更されました`,
        409,
        "LOCALE_BASELINE_CONFLICT",
        `/spec/translations/${item.locale}`
      );
    }
  }
  const before = validationErrors(original, patch.folderPath ? `${patch.folderPath}/_index.yaml` : "_index.yaml");
  const baseLocale = persistedBaseLocaleForTranslations(original, defaultLocale);
  if (!baseLocale) throw new RuntimeError("基本言語を解決できません", 422, "BASE_LOCALE");
  if (!original.spec.locale && (patch.localeChanges.length || patch.removeLocales.length || patch.removeTranslationKeys?.length)) {
    document.setIn(["spec", "locale"], baseLocale);
  }

  for (const item of patch.localeChanges) {
    let folder = document.toJS({ maxAliasCount: 100 }) as Folder;
    if (item.operation === "create") {
      create(document, folder, item, baseLocale);
      folder = document.toJS({ maxAliasCount: 100 }) as Folder;
    }
    const target = paths(folder, item.locale, baseLocale);
    if (!target) throw new RuntimeError("更新対象localeがありません", 409, "LOCALE_NOT_FOUND");
    if (item.locale === baseLocale && item.visibility !== undefined) {
      throw new RuntimeError("基本言語のvisibilityは変更できません", 400, "BASE_VISIBILITY");
    }
    if (item.title !== undefined) document.setIn(target.title, item.title);
    if (item.description === null) document.deleteIn(target.description);
    else if (item.description !== undefined) document.setIn(target.description, item.description);
    if (item.visibility !== undefined && "visibility" in target && target.visibility) {
      document.setIn(target.visibility, item.visibility);
    }
  }
  for (const item of patch.removeLocales) {
    const folder = document.toJS({ maxAliasCount: 100 }) as Folder;
    if (item === baseLocale) throw new RuntimeError("基本言語は削除できません", 400, "REMOVE_BASE_LOCALE");
    const key = rawKey(folder, item);
    if (!key) throw new RuntimeError("削除対象localeがありません", 409, "LOCALE_NOT_FOUND");
    document.deleteIn(["spec", "translations", key]);
  }
  for (const key of patch.removeTranslationKeys ?? []) {
    const folder = document.toJS({ maxAliasCount: 100 }) as Folder;
    const invalidKeys = validateFolder(folder, "").invalidTranslations.map((item) => item.rawKey);
    if (!invalidKeys.includes(key)) {
      throw new RuntimeError("不正translation keyが見つかりません", 409, "INVALID_TRANSLATION_NOT_FOUND");
    }
    document.deleteIn(["spec", "translations", key]);
  }

  const output = document.toString({ lineWidth: 0 });
  const checked = parseDocument(output);
  const value = checked.toJS();
  const validated = validateFolder(value, patch.folderPath ? `${patch.folderPath}/_index.yaml` : "_index.yaml");
  const after = validationErrors(value, patch.folderPath);
  const introduced = [...after].filter((item) => !before.has(item));
  if (checked.errors.length || !validated.folder || introduced.length) {
    throw new RuntimeError("保存後のFolder検証に失敗しました", 422, "SAVE_VALIDATION");
  }
  const temporary = path.join(
    directoryReal,
    `._index.yaml.vellym-${process.pid}-${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await writeFile(temporary, output, {
      encoding: "utf8",
      flag: "wx",
      ...(fileMode === undefined ? {} : { mode: fileMode })
    });
    if (fileMode !== undefined) await chmod(temporary, fileMode);
    const reread = parseDocument(await readFile(temporary, "utf8"));
    if (reread.errors.length || !validateFolder(reread.toJS(), patch.folderPath).folder) {
      throw new RuntimeError("一時Folderファイルの検証に失敗しました", 422, "TEMP_VALIDATION");
    }
    await rename(temporary, indexPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const savedFolder = validated.folder;
  return {
    path: patch.folderPath,
    name: patch.folderPath ? path.posix.basename(patch.folderPath) : "",
    title: savedFolder.metadata.title,
    ...(savedFolder.spec.description === undefined
      ? {}
      : { description: savedFolder.spec.description }),
    order: savedFolder.spec.order ?? [],
    readOnly: false,
    readOnlyReasons: [],
    hash: contentHash(output),
    localeHashes: folderLocaleHashes(savedFolder, defaultLocale)
  };
}
