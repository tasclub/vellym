import * as Ajv2020Module from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import type { ErrorObject, Options, ValidateFunction } from "ajv";
import pageSchema from "../schemas/page.schema.json" with { type: "json" };
import richTextSchema from "../schemas/rich-text-block.schema.json" with { type: "json" };
import configSchema from "../schemas/config.schema.json" with { type: "json" };
import folderSchema from "../schemas/folder.schema.json" with { type: "json" };
import pageTranslationSchema from "../schemas/page-translation.schema.json" with { type: "json" };
import folderTranslationSchema from "../schemas/folder-translation.schema.json" with { type: "json" };
import resourceSchema from "../schemas/resource.schema.json" with { type: "json" };
import {
  SUPPORTED_API_VERSIONS,
  type Diagnostic,
  type VellymConfig,
  type Folder,
  type FolderTranslation,
  type InvalidTranslation,
  type Page,
  type PageTranslation,
  type RichTextBlock,
  type ValidTranslation,
  type VellymResource
} from "./types.js";
import { normalizeLocale } from "./i18n.js";

const Ajv2020 = Ajv2020Module.default as unknown as new (options?: Options) => {
  compile<T>(schema: object): ValidateFunction<T>;
};

interface Validators {
  page: ValidateFunction<Page>;
  resource: ValidateFunction<VellymResource>;
  folder: ValidateFunction<Folder>;
  pageTranslation: ValidateFunction<PageTranslation>;
  folderTranslation: ValidateFunction<FolderTranslation>;
  richText: ValidateFunction<RichTextBlock>;
  config: ValidateFunction<VellymConfig>;
}

let validators: Validators | undefined;

function getValidators(): Validators {
  if (validators) return validators;

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const addFormats = addFormatsModule.default as unknown as (
    instance: typeof ajv
  ) => void;
  addFormats(ajv);
  validators = {
    page: ajv.compile<Page>(pageSchema),
    resource: ajv.compile<VellymResource>(resourceSchema),
    folder: ajv.compile<Folder>(folderSchema),
    pageTranslation: ajv.compile<PageTranslation>(pageTranslationSchema),
    folderTranslation: ajv.compile<FolderTranslation>(folderTranslationSchema),
    richText: ajv.compile<RichTextBlock>(richTextSchema),
    config: ajv.compile<VellymConfig>(configSchema)
  };
  return validators;
}

// AJVの英語メッセージは日本語UI・CLIに技術的な英語文字列を混在させるため、
// 代表的なkeywordを日本語へ変換する。未知のkeywordは元のメッセージへ委ねる。
function japaneseMessageFromAjv(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "required":
      return `必須項目「${String(params.missingProperty)}」がありません`;
    case "type":
      return `型が不正です（${String(params.type)}である必要があります）`;
    case "enum": {
      const allowed = Array.isArray(params.allowedValues)
        ? params.allowedValues.join("、 ")
        : "";
      return `値が許可されていません（許可値: ${allowed}）`;
    }
    case "additionalProperties":
      return `想定外の項目「${String(params.additionalProperty)}」があります`;
    case "format":
      return `形式が不正です（${String(params.format)}形式である必要があります）`;
    case "const":
      return `値が固定値と一致しません（${String(params.allowedValue)}である必要があります）`;
    case "minLength":
      return `文字数が不足しています（${String(params.limit)}文字以上が必要です）`;
    case "maxLength":
      return `文字数が多すぎます（${String(params.limit)}文字以下にしてください）`;
    case "minItems":
      return `要素数が不足しています（${String(params.limit)}件以上が必要です）`;
    case "pattern":
      return `形式が不正です（パターン ${String(params.pattern)} に一致しません）`;
    default:
      return error.message ?? "スキーマ検証に失敗しました";
  }
}

function diagnosticsFromAjv(
  errors: ErrorObject[] | null | undefined,
  file: string,
  code: string,
  pathPrefix = ""
): Diagnostic[] {
  return (errors ?? []).map((error) => ({
    file,
    path: `${pathPrefix}${error.instancePath}` || "/",
    severity: "error",
    code,
    message: japaneseMessageFromAjv(error)
  }));
}

export function isVellymCandidate(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return SUPPORTED_API_VERSIONS.some(
    (version) => version === (value as Record<string, unknown>).apiVersion
  );
}

/** Coreが組み込みで解釈するkind。これ以外はプラグインが提供する。 */
export const BUILT_IN_KINDS = ["Page", "Folder"] as const;

export function resourceKind(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const kind = (value as Record<string, unknown>).kind;
  return typeof kind === "string" && kind ? kind : undefined;
}

/**
 * Coreが種別固有スキーマを持たないkindか。プラグインが登録していないkindの
 * ファイルは、Pageスキーマで検証せず、共通契約の範囲だけを解釈する。
 * 解釈できないことをerrorにせず、無視して壊れないようにするための判定。
 */
export function isUnknownKind(value: unknown): boolean {
  const kind = resourceKind(value);
  return kind !== undefined && !(BUILT_IN_KINDS as readonly string[]).includes(kind);
}

// Pageのschemaは版ごとに分けない。追加（新しいblock種別、optionalな項目）は
// どの版でも同じschemaを通り、版を上げるのは破壊的変更のときだけとする。
// 実際に構造が異なる版を導入したときに初めてschemaを分割する。
export function validatePage(
  value: unknown,
  file: string
): {
  page?: Page;
  translations: ValidTranslation<PageTranslation>[];
  invalidTranslations: InvalidTranslation[];
  diagnostics: Diagnostic[];
} {
  const validator = getValidators().page;
  if (!validator(value)) {
    return {
      translations: [],
      invalidTranslations: [],
      diagnostics: diagnosticsFromAjv(validator.errors, file, "PAGE_SCHEMA")
    };
  }
  const diagnostics: Diagnostic[] = [];
  const translations: ValidTranslation<PageTranslation>[] = [];
  const invalidTranslations: InvalidTranslation[] = [];
  validateResourceLocale(value.spec.locale, file, "/spec/locale", diagnostics);
  validateTranslations(
    value.spec.translations,
    value.spec.locale,
    file,
    "page",
    translations,
    invalidTranslations,
    diagnostics
  );
  return { page: value, translations, invalidTranslations, diagnostics };
}

/**
 * Coreが種別固有スキーマを持たないkindを、共通契約だけで検証する。
 * 種別固有の`spec`は検証しない。解釈できないことをerrorにしない。
 */
export function validateResource(
  value: unknown,
  file: string
): {
  resource?: VellymResource;
  translations: ValidTranslation<PageTranslation>[];
  invalidTranslations: InvalidTranslation[];
  diagnostics: Diagnostic[];
} {
  const validator = getValidators().resource;
  if (!validator(value)) {
    return {
      translations: [],
      invalidTranslations: [],
      diagnostics: diagnosticsFromAjv(validator.errors, file, "RESOURCE_SCHEMA")
    };
  }
  const diagnostics: Diagnostic[] = [];
  const translations: ValidTranslation<PageTranslation>[] = [];
  const invalidTranslations: InvalidTranslation[] = [];
  validateResourceLocale(value.spec.locale, file, "/spec/locale", diagnostics);
  validateTranslations(
    value.spec.translations,
    value.spec.locale,
    file,
    "page",
    translations,
    invalidTranslations,
    diagnostics
  );
  return { resource: value, translations, invalidTranslations, diagnostics };
}

export function validateFolder(
  value: unknown,
  file: string
): {
  folder?: Folder;
  translations: ValidTranslation<FolderTranslation>[];
  invalidTranslations: InvalidTranslation[];
  diagnostics: Diagnostic[];
} {
  const validator = getValidators().folder;
  if (!validator(value)) {
    return {
      translations: [],
      invalidTranslations: [],
      diagnostics: diagnosticsFromAjv(validator.errors, file, "FOLDER_SCHEMA")
    };
  }
  const diagnostics: Diagnostic[] = [];
  const translations: ValidTranslation<FolderTranslation>[] = [];
  const invalidTranslations: InvalidTranslation[] = [];
  validateResourceLocale(value.spec.locale, file, "/spec/locale", diagnostics);
  validateTranslations(
    value.spec.translations,
    value.spec.locale,
    file,
    "folder",
    translations,
    invalidTranslations,
    diagnostics
  );
  return { folder: value, translations, invalidTranslations, diagnostics };
}

function validateResourceLocale(
  raw: string | undefined,
  file: string,
  path: string,
  diagnostics: Diagnostic[]
): void {
  if (raw === undefined) return;
  const normalized = normalizeLocale(raw);
  if (!normalized.valid) {
    diagnostics.push({
      file,
      path,
      severity: "error",
      code: "INVALID_LOCALE",
      message: `locale「${raw}」はVellymで利用できる形式ではありません`
    });
  } else if (!normalized.canonicalInput) {
    diagnostics.push({
      file,
      path,
      severity: "warning",
      code: "NON_CANONICAL_LOCALE",
      message: `locale「${raw}」のcanonical表記は「${normalized.canonical}」です`
    });
  }
}

function isRepairableTranslation(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateTranslations<T extends PageTranslation | FolderTranslation>(
  rawTranslations: Record<string, unknown> | undefined,
  rawBaseLocale: string | undefined,
  file: string,
  kind: "page" | "folder",
  valid: ValidTranslation<T>[],
  invalid: InvalidTranslation[],
  diagnostics: Diagnostic[]
): void {
  if (!rawTranslations) return;
  if (!rawBaseLocale) {
    diagnostics.push({
      file,
      path: "/spec/locale",
      severity: "error",
      code: "LOCALE_REQUIRED_FOR_TRANSLATIONS",
      message: "translationsを持つresourceにはspec.localeが必要です"
    });
  }

  const entries = Object.entries(rawTranslations).map(([rawKey, value]) => ({
    rawKey,
    value,
    normalized: normalizeLocale(rawKey)
  }));
  const canonicalCounts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.normalized.valid) continue;
    const locale = entry.normalized.canonical!;
    canonicalCounts.set(locale, (canonicalCounts.get(locale) ?? 0) + 1);
  }
  const baseLocale = rawBaseLocale
    ? normalizeLocale(rawBaseLocale).canonical
    : undefined;

  for (const entry of entries) {
    const path = `/spec/translations/${entry.rawKey}`;
    const entryDiagnostics: Diagnostic[] = [];
    if (!baseLocale) {
      entryDiagnostics.push({
        file,
        path,
        severity: "error",
        code: rawBaseLocale
          ? "INVALID_BASE_LOCALE_FOR_TRANSLATIONS"
          : "LOCALE_REQUIRED_FOR_TRANSLATIONS",
        message: rawBaseLocale
          ? "基本言語が不正なためtranslationを有効化できません"
          : "spec.localeを固定するまでtranslationを有効化できません"
      });
    }
    if (!entry.normalized.valid) {
      entryDiagnostics.push({
        file,
        path,
        severity: "error",
        code: "INVALID_TRANSLATION_LOCALE",
        message: `translation locale「${entry.rawKey}」はVellymで利用できる形式ではありません`
      });
    } else {
      const locale = entry.normalized.canonical!;
      if (!entry.normalized.canonicalInput) {
        entryDiagnostics.push({
          file,
          path,
          severity: "warning",
          code: "NON_CANONICAL_TRANSLATION_LOCALE",
          message: `translation key「${entry.rawKey}」のcanonical表記は「${locale}」です`
        });
      }
      if ((canonicalCounts.get(locale) ?? 0) > 1) {
        entryDiagnostics.push({
          file,
          path,
          severity: "error",
          code: "DUPLICATE_TRANSLATION_LOCALE",
          message: `canonical化するとlocale「${locale}」が重複します`
        });
      }
      if (baseLocale === locale) {
        entryDiagnostics.push({
          file,
          path,
          severity: "error",
          code: "DUPLICATE_BASE_LOCALE",
          message: `基本言語「${locale}」をtranslationsへ重複して指定できません`
        });
      }
    }

    const validator = kind === "page"
      ? getValidators().pageTranslation as ValidateFunction<unknown>
      : getValidators().folderTranslation as ValidateFunction<unknown>;
    if (!validator(entry.value)) {
      entryDiagnostics.push(
        ...diagnosticsFromAjv(
          validator.errors,
          file,
          kind === "page" ? "PAGE_TRANSLATION_SCHEMA" : "FOLDER_TRANSLATION_SCHEMA",
          path
        )
      );
    } else {
      const translation = entry.value as T;
      const visibility = translation.visibility ?? "published";
      if (visibility === "published" && !translation.title.trim()) {
        entryDiagnostics.push({
          file,
          path: `${path}/title`,
          severity: "error",
          code: "PUBLISHED_TRANSLATION_TITLE",
          message: "公開するtranslationのtitleは空にできません"
        });
      }
      if (kind === "page" && visibility === "published") {
        const blockResult = knownRichTextBlocksFrom(
          (translation as PageTranslation).blocks ?? [],
          file,
          `${path}/blocks`
        );
        entryDiagnostics.push(...blockResult.diagnostics);
      }
    }

    const errors = entryDiagnostics.filter((item) => item.severity === "error");
    diagnostics.push(...entryDiagnostics);
    if (errors.length || !entry.normalized.valid) {
      invalid.push({
        rawKey: entry.rawKey,
        ...(entry.normalized.canonical
          ? { canonicalLocale: entry.normalized.canonical }
          : {}),
        path,
        diagnostics: entryDiagnostics,
        repairable: isRepairableTranslation(entry.value),
        value: entry.value
      });
    } else {
      valid.push({
        rawKey: entry.rawKey,
        locale: entry.normalized.canonical!,
        value: entry.value as T
      });
    }
  }
}

export function validateConfig(
  value: unknown,
  file: string
): { config?: VellymConfig; diagnostics: Diagnostic[] } {
  const validator = getValidators().config;
  if (!validator(value)) {
    return {
      diagnostics: diagnosticsFromAjv(validator.errors, file, "CONFIG_SCHEMA")
    };
  }
  const diagnostics: Diagnostic[] = [];
  const localeValues = [
    ...(value.i18n?.defaultLocale
      ? [["/i18n/defaultLocale", value.i18n.defaultLocale] as const]
      : []),
    ...Object.keys(value.i18n?.displayNames ?? {}).map(
      (locale) => [`/i18n/displayNames/${locale}`, locale] as const
    )
  ];
  for (const [path, locale] of localeValues) {
    validateResourceLocale(locale, file, path, diagnostics);
  }
  if (diagnostics.some((item) => item.severity === "error")) {
    return { diagnostics };
  }
  return { config: value, diagnostics };
}

export function knownRichTextBlocks(
  page: Page,
  file: string
): { blocks: RichTextBlock[]; diagnostics: Diagnostic[] } {
  return knownRichTextBlocksFrom(page.spec.blocks ?? [], file, "/spec/blocks");
}

export function knownRichTextBlocksFrom(
  sourceBlocks: unknown[],
  file: string,
  pathPrefix = "/spec/blocks"
): { blocks: RichTextBlock[]; diagnostics: Diagnostic[] } {
  const validateRichTextSchema = getValidators().richText;
  const blocks: RichTextBlock[] = [];
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  for (const [index, block] of sourceBlocks.entries()) {
    if (!block || typeof block !== "object") continue;
    const candidate = block as Record<string, unknown>;
    if (candidate.type !== "rich-text") continue;
    if (!validateRichTextSchema(block)) {
      diagnostics.push(
        ...diagnosticsFromAjv(
          validateRichTextSchema.errors,
          file,
          `RICH_TEXT_BLOCK_${index}`,
          `${pathPrefix}/${index}`
        )
      );
      continue;
    }
    if (ids.has(block.id)) {
      diagnostics.push({
        file,
        path: `${pathPrefix}/${index}/id`,
        severity: "error",
        code: "DUPLICATE_BLOCK_ID",
        message: `rich-text block ID ${block.id} is duplicated`
      });
      continue;
    }
    ids.add(block.id);
    blocks.push(block);
  }
  return { blocks, diagnostics };
}
