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
import { isNode, isPair, parseDocument, type Document } from "yaml";
import {
  knownRichTextBlocks,
  normalizeLocale,
  persistedBaseLocaleForTranslations,
  validatePage,
  type Page,
  type PageView
} from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { contentHash, isInside } from "./path-utils.js";
import { pageLocaleHashes } from "./locale-hash.js";
import { loadRepository } from "./repository.js";
import type { LoadedPage, LocaleChange, PagePatch } from "./types.js";

function patchObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError("PATCH本文はobjectで指定してください", 400, "INVALID_PATCH");
  }
  return value as Record<string, unknown>;
}

function hash(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new RuntimeError(`${name}が不正です`, 400, "INVALID_PATCH");
  }
  return value;
}

function writableLocale(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new RuntimeError(`${name}が不正です`, 400, "INVALID_PATCH");
  }
  const normalized = normalizeLocale(value);
  if (!normalized.valid || !normalized.canonicalInput) {
    throw new RuntimeError(
      `${name}はcanonical locale tagで指定してください`,
      400,
      "INVALID_PATCH"
    );
  }
  return normalized.canonical!;
}

function rawTranslationKey(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 100 ||
    value.includes("\0") ||
    value === "__proto__"
  ) {
    throw new RuntimeError(`${name}が不正です`, 400, "INVALID_PATCH");
  }
  return value;
}

function richTextChanges(
  value: unknown,
  name = "richTextBlocks"
): Array<{ id: string; content: string }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new RuntimeError(`${name}は配列で指定してください`, 400, "INVALID_PATCH");
  }
  const changes = value.map((item) => {
    const candidate = patchObject(item);
    if (typeof candidate.id !== "string" || typeof candidate.content !== "string") {
      throw new RuntimeError(`${name}の要素が不正です`, 400, "INVALID_PATCH");
    }
    return { id: candidate.id, content: candidate.content };
  });
  if (new Set(changes.map(({ id }) => id)).size !== changes.length) {
    throw new RuntimeError("同じblock IDを複数回変更できません", 400, "INVALID_PATCH");
  }
  return changes;
}

function localeChange(value: unknown, index: number): LocaleChange {
  const candidate = patchObject(value);
  const locale = writableLocale(candidate.locale, `localeChanges[${index}].locale`);
  if (candidate.operation !== "create" && candidate.operation !== "update") {
    throw new RuntimeError("locale operationが不正です", 400, "INVALID_PATCH");
  }
  const operation = candidate.operation;
  let initialize: LocaleChange["initialize"];
  if (operation === "create") {
    if (
      !candidate.initialize ||
      typeof candidate.initialize !== "object" ||
      Array.isArray(candidate.initialize)
    ) {
      throw new RuntimeError("createにはinitializeが必要です", 400, "INVALID_PATCH");
    }
    const raw = patchObject(candidate.initialize);
    if (raw.type === "empty") initialize = { type: "empty" };
    else if (raw.type === "copy") {
      initialize = {
        type: "copy",
        sourceLocale: writableLocale(raw.sourceLocale, "initialize.sourceLocale")
      };
    } else {
      throw new RuntimeError("createにはinitializeが必要です", 400, "INVALID_PATCH");
    }
  } else if (candidate.initialize !== undefined) {
    throw new RuntimeError("updateにinitializeは指定できません", 400, "INVALID_PATCH");
  }
  if (operation === "create" && candidate.baselineHash !== undefined) {
    throw new RuntimeError("createにbaselineHashは指定できません", 400, "INVALID_PATCH");
  }
  if (
    candidate.visibility !== undefined &&
    candidate.visibility !== "draft" &&
    candidate.visibility !== "published"
  ) {
    throw new RuntimeError("visibilityが不正です", 400, "INVALID_PATCH");
  }
  if (candidate.title !== undefined && typeof candidate.title !== "string") {
    throw new RuntimeError("locale titleは文字列で指定してください", 400, "INVALID_PATCH");
  }
  return {
    locale,
    operation,
    ...(candidate.baselineHash === undefined
      ? {}
      : { baselineHash: hash(candidate.baselineHash, "baselineHash") }),
    ...(candidate.visibility === undefined
      ? {}
      : { visibility: candidate.visibility }),
    ...(initialize ? { initialize } : {}),
    ...(candidate.title === undefined ? {} : { title: candidate.title }),
    ...(candidate.richTextBlocks === undefined
      ? {}
      : { richTextBlocks: richTextChanges(candidate.richTextBlocks)! })
  };
}

export function parsePagePatch(value: unknown): PagePatch {
  const candidate = patchObject(value);
  const baseHash = hash(candidate.baseHash, "baseHash");
  if (
    candidate.title !== undefined &&
    (typeof candidate.title !== "string" || candidate.title.length === 0)
  ) {
    throw new RuntimeError("titleは空でない文字列で指定してください", 400, "INVALID_PATCH");
  }
  if (
    candidate.slug !== undefined &&
    (typeof candidate.slug !== "string" ||
      candidate.slug.length > 120 ||
      !/^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u.test(candidate.slug))
  ) {
    throw new RuntimeError("URL名が不正です", 400, "INVALID_PATCH");
  }
  let localeChanges: LocaleChange[] | undefined;
  if (candidate.localeChanges !== undefined) {
    if (!Array.isArray(candidate.localeChanges)) {
      throw new RuntimeError("localeChangesは配列で指定してください", 400, "INVALID_PATCH");
    }
    localeChanges = candidate.localeChanges.map(localeChange);
    if (new Set(localeChanges.map(({ locale }) => locale)).size !== localeChanges.length) {
      throw new RuntimeError("同じlocaleを複数回変更できません", 400, "INVALID_PATCH");
    }
  }
  let removeLocales: string[] | undefined;
  if (candidate.removeLocales !== undefined) {
    if (!Array.isArray(candidate.removeLocales)) {
      throw new RuntimeError("removeLocalesは配列で指定してください", 400, "INVALID_PATCH");
    }
    removeLocales = candidate.removeLocales.map((locale, index) =>
      writableLocale(locale, `removeLocales[${index}]`)
    );
    if (new Set(removeLocales).size !== removeLocales.length) {
      throw new RuntimeError("同じlocaleを複数回削除できません", 400, "INVALID_PATCH");
    }
  }
  if (removeLocales?.some((locale) => localeChanges?.some((change) => change.locale === locale))) {
    throw new RuntimeError("同じlocaleを変更と削除へ同時指定できません", 400, "INVALID_PATCH");
  }
  let removeTranslationKeys: string[] | undefined;
  if (candidate.removeTranslationKeys !== undefined) {
    if (!Array.isArray(candidate.removeTranslationKeys)) {
      throw new RuntimeError("removeTranslationKeysは配列で指定してください", 400, "INVALID_PATCH");
    }
    removeTranslationKeys = candidate.removeTranslationKeys.map((key, index) =>
      rawTranslationKey(key, `removeTranslationKeys[${index}]`)
    );
    if (new Set(removeTranslationKeys).size !== removeTranslationKeys.length) {
      throw new RuntimeError("同じtranslation keyを複数回削除できません", 400, "INVALID_PATCH");
    }
  }
  return {
    baseHash,
    ...(candidate.title === undefined ? {} : { title: candidate.title as string }),
    ...(candidate.slug === undefined
      ? {}
      : { slug: (candidate.slug as string).normalize("NFC") }),
    ...(candidate.richTextBlocks === undefined
      ? {}
      : { richTextBlocks: richTextChanges(candidate.richTextBlocks)! }),
    ...(localeChanges === undefined ? {} : { localeChanges }),
    ...(removeLocales === undefined ? {} : { removeLocales }),
    ...(removeTranslationKeys === undefined ? {} : { removeTranslationKeys })
  };
}

function translationRawKey(page: Page, locale: string): string | undefined {
  const matches = Object.keys(page.spec.translations ?? {}).filter((rawKey) =>
    normalizeLocale(rawKey).canonical === locale
  );
  if (matches.length > 1) {
    throw new RuntimeError(
      `locale ${locale} はcanonical化すると重複するため編集できません`,
      409,
      "LOCALE_CONFLICT"
    );
  }
  return matches[0];
}

function cloneYamlNode(value: unknown, document: Document.Parsed): unknown {
  if (isNode(value) || isPair(value)) return value.clone(document.schema);
  return value;
}

function targetPaths(page: Page, locale: string, baseLocale: string): {
  title: Array<string | number>;
  blocks: Array<string | number>;
  visibility?: Array<string | number>;
  rawKey?: string;
} | undefined {
  if (locale === baseLocale) {
    return { title: ["metadata", "title"], blocks: ["spec", "blocks"] };
  }
  const rawKey = translationRawKey(page, locale);
  if (!rawKey) return undefined;
  const base = ["spec", "translations", rawKey];
  return {
    title: [...base, "title"],
    blocks: [...base, "blocks"],
    visibility: [...base, "visibility"],
    rawKey
  };
}

function applyRichTextChanges(
  document: Document.Parsed,
  page: Page,
  blocksPath: Array<string | number>,
  changes: Array<{ id: string; content: string }>
): void {
  const blocks = blocksPath.length === 2
    ? page.spec.blocks ?? []
    : (() => {
        const rawKey = String(blocksPath[2]);
        const translation = page.spec.translations?.[rawKey];
        if (!translation || typeof translation !== "object" || Array.isArray(translation)) {
          return [];
        }
        const candidate = (translation as Record<string, unknown>).blocks;
        return Array.isArray(candidate) ? candidate : [];
      })();
  for (const change of changes) {
    const indexes = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.type === "rich-text" && block.id === change.id);
    if (indexes.length !== 1) {
      throw new RuntimeError(
        `rich-text block ${change.id} を一意に特定できません`,
        400,
        "BLOCK_NOT_FOUND"
      );
    }
    const target = indexes[0]!;
    if (target.block.type !== "rich-text") {
      throw new RuntimeError("編集可能なrich-textではありません", 400, "INVALID_BLOCK");
    }
    document.setIn([...blocksPath, target.index, "content"], change.content);
  }
}

function validationErrors(page: unknown, file: string): Set<string> {
  const result = validatePage(page, file);
  return new Set(
    result.diagnostics
      .filter(({ severity }) => severity === "error")
      .map(({ code, path: itemPath }) => `${code}:${itemPath ?? "/"}`)
  );
}

function assertNoNewValidationErrors(
  before: Set<string>,
  afterPage: unknown,
  file: string
): void {
  const after = validationErrors(afterPage, file);
  const introduced = [...after].filter((item) => !before.has(item));
  if (introduced.length) {
    throw new RuntimeError(
      `保存後のPage検証に失敗しました: ${introduced.join("、")}`,
      422,
      "SAVE_VALIDATION"
    );
  }
}

function createTranslation(
  document: Document.Parsed,
  page: Page,
  change: LocaleChange,
  baseLocale: string
): void {
  if (change.locale === baseLocale || translationRawKey(page, change.locale)) {
    throw new RuntimeError(
      `locale ${change.locale} は既に存在します`,
      409,
      "LOCALE_ALREADY_EXISTS"
    );
  }
  const target = ["spec", "translations", change.locale];
  if (change.initialize?.type === "empty") {
    document.setIn(target, document.createNode({
      visibility: change.visibility ?? "draft",
      title: "",
      blocks: []
    }));
  } else if (change.initialize?.type === "copy") {
    const source = targetPaths(page, change.initialize.sourceLocale, baseLocale);
    if (!source) {
      throw new RuntimeError(
        `コピー元locale ${change.initialize.sourceLocale} が見つかりません`,
        400,
        "SOURCE_LOCALE_NOT_FOUND"
      );
    }
    if (source.rawKey) {
      const sourceNode = document.getIn(
        ["spec", "translations", source.rawKey],
        true
      );
      document.setIn(target, cloneYamlNode(sourceNode, document));
    } else {
      document.setIn(target, document.createNode({
        visibility: "draft",
        title: "",
        blocks: []
      }));
      document.setIn(
        [...target, "title"],
        cloneYamlNode(document.getIn(source.title, true), document)
      );
      document.setIn(
        [...target, "blocks"],
        cloneYamlNode(document.getIn(source.blocks, true), document)
      );
    }
    document.setIn([...target, "visibility"], change.visibility ?? "draft");
  }
}

function applyLocaleChanges(
  document: Document.Parsed,
  patch: PagePatch,
  defaultLocale: string
): void {
  if (!(patch.localeChanges?.length || patch.removeLocales?.length || patch.removeTranslationKeys?.length)) return;
  let page = document.toJS({ maxAliasCount: 100 }) as Page;
  const baseLocale = persistedBaseLocaleForTranslations(page, defaultLocale);
  if (!baseLocale) {
    throw new RuntimeError("基本言語を解決できません", 422, "BASE_LOCALE");
  }
  if (!page.spec.locale) {
    document.setIn(["spec", "locale"], baseLocale);
    page = document.toJS({ maxAliasCount: 100 }) as Page;
  }

  if (
    (patch.title !== undefined || patch.richTextBlocks?.length) &&
    patch.localeChanges?.some(({ locale }) => locale === baseLocale)
  ) {
    throw new RuntimeError(
      "基本言語をlegacy項目とlocaleChangesの両方で変更できません",
      400,
      "AMBIGUOUS_BASE_CHANGE"
    );
  }

  for (const change of patch.localeChanges ?? []) {
    page = document.toJS({ maxAliasCount: 100 }) as Page;
    if (change.operation === "create") {
      createTranslation(document, page, change, baseLocale);
      page = document.toJS({ maxAliasCount: 100 }) as Page;
    }
    const paths = targetPaths(page, change.locale, baseLocale);
    if (!paths) {
      throw new RuntimeError(
        `locale ${change.locale} が見つかりません`,
        409,
        "LOCALE_NOT_FOUND"
      );
    }
    if (change.operation === "update" && change.locale !== baseLocale && !paths.rawKey) {
      throw new RuntimeError("更新対象localeが存在しません", 409, "LOCALE_NOT_FOUND");
    }
    if (change.locale === baseLocale && change.visibility !== undefined) {
      throw new RuntimeError("基本言語のvisibilityは変更できません", 400, "BASE_VISIBILITY");
    }
    if (change.title !== undefined) document.setIn(paths.title, change.title);
    if (change.visibility !== undefined && paths.visibility) {
      document.setIn(paths.visibility, change.visibility);
    }
    if (change.richTextBlocks) {
      page = document.toJS({ maxAliasCount: 100 }) as Page;
      applyRichTextChanges(document, page, paths.blocks, change.richTextBlocks);
    }
  }

  for (const locale of patch.removeLocales ?? []) {
    page = document.toJS({ maxAliasCount: 100 }) as Page;
    if (locale === baseLocale) {
      throw new RuntimeError("基本言語は削除できません", 400, "REMOVE_BASE_LOCALE");
    }
    const rawKey = translationRawKey(page, locale);
    if (!rawKey) {
      throw new RuntimeError(`locale ${locale} が見つかりません`, 409, "LOCALE_NOT_FOUND");
    }
    document.deleteIn(["spec", "translations", rawKey]);
  }
  for (const rawKey of patch.removeTranslationKeys ?? []) {
    page = document.toJS({ maxAliasCount: 100 }) as Page;
    const invalidKeys = validatePage(page, "").invalidTranslations.map((item) => item.rawKey);
    if (!invalidKeys.includes(rawKey)) {
      throw new RuntimeError(`不正translation key ${rawKey} が見つかりません`, 409, "INVALID_TRANSLATION_NOT_FOUND");
    }
    document.deleteIn(["spec", "translations", rawKey]);
  }
}

export async function savePage(
  contentRoot: string,
  loaded: LoadedPage,
  patch: PagePatch,
  defaultLocale = loaded.configuredBaseLocale ?? "ja",
  repository?: import("./types.js").RepositorySnapshot
): Promise<PageView> {
  if (loaded.readOnly) {
    throw new RuntimeError(
      loaded.readOnlyReasons?.join("、") || "読み取り専用です",
      422,
      "READ_ONLY"
    );
  }
  const rootReal = await realpath(contentRoot);
  const sourceReal = await realpath(path.join(contentRoot, loaded.relativePath));
  if (!isInside(rootReal, sourceReal)) {
    throw new RuntimeError("contentRoot外への保存は許可されていません", 422, "PATH_BOUNDARY");
  }
  const info = await lstat(sourceReal);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new RuntimeError("通常ファイル以外は保存できません", 422, "UNSAFE_FILE");
  }
  const source = await readFile(sourceReal, "utf8");
  if (contentHash(source) !== patch.baseHash) {
    const locales = [
      ...(patch.localeChanges ?? []).map(({ locale }) => locale),
      ...(patch.removeLocales ?? []),
      ...(patch.removeTranslationKeys ?? [])
    ];
    throw new RuntimeError(
      `外部変更を検出しました。YAMLから再読み込みしてください${
        locales.length ? `（対象言語: ${locales.join("、")}）` : ""
      }`,
      409,
      "HASH_CONFLICT",
      locales.length ? "/spec/translations" : undefined
    );
  }
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length) {
    throw new RuntimeError(document.errors[0]!.message, 422, "YAML_PARSE");
  }
  const original = document.toJS({ maxAliasCount: 100 }) as Page;
  const currentLocaleHashes = pageLocaleHashes(original, defaultLocale);
  for (const item of patch.localeChanges ?? []) {
    if (
      item.operation === "update" &&
      item.baselineHash !== undefined &&
      currentLocaleHashes[item.locale] !== item.baselineHash
    ) {
      throw new RuntimeError(
        `locale ${item.locale} の編集開始後に内容が変更されました`,
        409,
        "LOCALE_BASELINE_CONFLICT",
        item.locale === (original.spec.locale ?? defaultLocale)
          ? "/spec/blocks"
          : `/spec/translations/${item.locale}`
      );
    }
  }
  const beforeErrors = validationErrors(original, loaded.relativePath);
  if (patch.title !== undefined) document.setIn(["metadata", "title"], patch.title);
  if (patch.slug !== undefined) {
    const snapshot = repository ?? await loadRepository(contentRoot);
    const duplicate = snapshot.bySlug.get(patch.slug.normalize("NFC").toLocaleLowerCase());
    if (duplicate && duplicate.name !== loaded.name) {
      throw new RuntimeError("同じURL名のPageがあります", 409, "DUPLICATE_PAGE_SLUG");
    }
    document.setIn(["metadata", "slug"], patch.slug);
  }
  if (patch.richTextBlocks) {
    applyRichTextChanges(document, original, ["spec", "blocks"], patch.richTextBlocks);
  }
  applyLocaleChanges(document, patch, defaultLocale);

  const output = document.toString({ lineWidth: 0 });
  const checkedDocument = parseDocument(output);
  const checkedValue = checkedDocument.toJS();
  if (checkedDocument.errors.length || !validatePage(checkedValue, loaded.relativePath).page) {
    throw new RuntimeError("保存後のPage検証に失敗しました", 422, "SAVE_VALIDATION");
  }
  assertNoNewValidationErrors(beforeErrors, checkedValue, loaded.relativePath);

  const temporary = path.join(
    path.dirname(sourceReal),
    `.${path.basename(sourceReal)}.vellym-${process.pid}-${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await writeFile(temporary, output, { encoding: "utf8", mode: info.mode });
    await chmod(temporary, info.mode);
    const rereadDocument = parseDocument(await readFile(temporary, "utf8"));
    const rereadValue = rereadDocument.toJS();
    if (rereadDocument.errors.length || !validatePage(rereadValue, loaded.relativePath).page) {
      throw new RuntimeError("一時ファイルの再検証に失敗しました", 422, "TEMP_VALIDATION");
    }
    assertNoNewValidationErrors(beforeErrors, rereadValue, loaded.relativePath);
    await rename(temporary, sourceReal);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const validatedOutput = validatePage(checkedValue, loaded.relativePath);
  if (!validatedOutput.page) {
    throw new RuntimeError("保存後のPageを再読込できません", 500, "RELOAD_FAILED");
  }
  const known = knownRichTextBlocks(validatedOutput.page, loaded.relativePath);
  return {
    page: validatedOutput.page,
    knownBlocks: known.blocks,
    relativePath: loaded.relativePath,
    hash: contentHash(output),
    readOnly: false,
    readOnlyReasons: [],
    localeHashes: pageLocaleHashes(validatedOutput.page, defaultLocale)
  };
}
