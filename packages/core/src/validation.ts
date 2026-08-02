import * as Ajv2020Module from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import type { ErrorObject, Options, ValidateFunction } from "ajv";
import pageSchema from "../schemas/page.schema.json" with { type: "json" };
import pageV1Schema from "../schemas/page-v1.schema.json" with { type: "json" };
import richTextSchema from "../schemas/rich-text-block.schema.json" with { type: "json" };
import configSchema from "../schemas/config.schema.json" with { type: "json" };
import {
  STABLE_API_VERSION,
  SUPPORTED_API_VERSIONS,
  type Diagnostic,
  type VellymConfig,
  type Page,
  type RichTextBlock
} from "./types.js";

const Ajv2020 = Ajv2020Module.default as unknown as new (options?: Options) => {
  compile<T>(schema: object): ValidateFunction<T>;
};

interface Validators {
  page: ValidateFunction<Page>;
  pageV1: ValidateFunction<Page>;
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
    pageV1: ajv.compile<Page>(pageV1Schema),
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
  code: string
): Diagnostic[] {
  return (errors ?? []).map((error) => ({
    file,
    path: error.instancePath || "/",
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

export function validatePage(
  value: unknown,
  file: string
): { page?: Page; diagnostics: Diagnostic[] } {
  const validators = getValidators();
  const validator =
    value && typeof value === "object" &&
    (value as Record<string, unknown>).apiVersion === STABLE_API_VERSION
      ? validators.pageV1
      : validators.page;
  if (!validator(value)) {
    return {
      diagnostics: diagnosticsFromAjv(validator.errors, file, "PAGE_SCHEMA")
    };
  }
  return { page: value, diagnostics: [] };
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
  return { config: value, diagnostics: [] };
}

export function knownRichTextBlocks(
  page: Page,
  file: string
): { blocks: RichTextBlock[]; diagnostics: Diagnostic[] } {
  const validateRichTextSchema = getValidators().richText;
  const blocks: RichTextBlock[] = [];
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  for (const [index, block] of page.spec.blocks.entries()) {
    if (block.type !== "rich-text") continue;
    if (!validateRichTextSchema(block)) {
      diagnostics.push(
        ...diagnosticsFromAjv(
          validateRichTextSchema.errors,
          file,
          `RICH_TEXT_BLOCK_${index}`
        )
      );
      continue;
    }
    if (ids.has(block.id)) {
      diagnostics.push({
        file,
        path: `/spec/blocks/${index}/id`,
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
