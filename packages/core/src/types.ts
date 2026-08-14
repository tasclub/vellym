export const API_VERSION = "vellym.tasclub.com/v1alpha1" as const;
export const STABLE_API_VERSION = "vellym.tasclub.com/v1" as const;
export const SUPPORTED_API_VERSIONS = [API_VERSION, STABLE_API_VERSION] as const;
export type ApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];

export interface UnknownBlock {
  [key: string]: unknown;
}

export interface RichTextBlock extends UnknownBlock {
  id: string;
  type: "rich-text";
  format: "commonmark";
  content: string;
}

export type TranslationVisibility = "draft" | "published";

export interface PageTranslation {
  visibility?: TranslationVisibility;
  title: string;
  blocks: UnknownBlock[];
  [key: string]: unknown;
}

export interface FolderTranslation {
  visibility?: TranslationVisibility;
  title: string;
  description?: string;
  [key: string]: unknown;
}

export interface Page {
  apiVersion: ApiVersion;
  kind: "Page";
  metadata: {
    name: string;
    title: string;
    slug?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    [key: string]: unknown;
  };
  spec: {
    documentType?: string;
    locale?: string;
    blocks: UnknownBlock[];
    translations?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface Folder {
  apiVersion: ApiVersion;
  kind: "Folder";
  metadata: {
    title: string;
    [key: string]: unknown;
  };
  spec: {
    locale?: string;
    description?: string;
    order?: string[];
    translations?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface I18nConfig {
  defaultLocale?: string;
  displayNames?: Record<string, string>;
  [key: string]: unknown;
}

export interface VellymConfig {
  schemaVersion: "1.0";
  contentRoot: string;
  outputDir: string;
  ui: { language: "ja" | "en"; [key: string]: unknown };
  i18n?: I18nConfig;
  static?: { publicBaseUrl?: string; [key: string]: unknown };
  plugins: string[];
  [key: string]: unknown;
}

export interface InvalidTranslation {
  rawKey: string;
  canonicalLocale?: string;
  path: string;
  diagnostics: Diagnostic[];
  repairable: boolean;
  value: unknown;
}

export interface ValidTranslation<T> {
  rawKey: string;
  locale: string;
  value: T;
}

export interface LocalizedPageProjection {
  page: Page;
  locale: string;
  baseLocale: string;
  isBaseLocale: boolean;
  visibility: "published";
  knownBlocks: RichTextBlock[];
}

export interface LocalizedFolderProjection {
  folder: Folder;
  locale: string;
  baseLocale: string;
  isBaseLocale: boolean;
  sourceLocale: string;
}

export interface PageLocaleEditView {
  locale: string;
  isBaseLocale: boolean;
  visibility: "draft" | "published";
  title: string;
  blocks: RichTextBlock[];
  baselineHash: string;
}

export interface PageEditView {
  pageId: string;
  slug: string;
  relativePath: string;
  hash: string;
  baseLocale: string;
  locales: PageLocaleEditView[];
  invalidTranslations: InvalidTranslation[];
  readOnly: boolean;
  readOnlyReasons: string[];
}

export interface FolderLocaleEditView {
  locale: string;
  isBaseLocale: boolean;
  visibility: "draft" | "published";
  title: string;
  description?: string;
  baselineHash: string;
}

export interface FolderEditView {
  folderPath: string;
  hash: string | null;
  baseLocale: string;
  locales: FolderLocaleEditView[];
  invalidTranslations: InvalidTranslation[];
  readOnly: boolean;
  readOnlyReasons: string[];
}

export type DiagnosticSeverity = "warning" | "error";

export interface Diagnostic {
  file: string;
  path?: string;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
}

export interface PageSummary {
  name: string;
  slug?: string;
  title: string;
  relativePath: string;
  readOnly: boolean;
  locale?: string;
  baseLocale?: string;
}

export interface FolderSummary {
  path: string;
  name: string;
  title: string;
  description?: string;
  order: string[];
  readOnly: boolean;
  readOnlyReasons: string[];
  locale?: string;
  baseLocale?: string;
  sourceLocale?: string;
  hash?: string;
  localeHashes?: Record<string, string>;
}

export interface PageView {
  page: Page;
  knownBlocks: RichTextBlock[];
  relativePath: string;
  hash: string;
  readOnly: boolean;
  readOnlyReasons: string[];
  locale?: string;
  requestedLocale?: string;
  baseLocale?: string;
  availableLocales?: string[];
  editableLocales?: string[];
  isBaseLocale?: boolean;
  invalidTranslations?: InvalidTranslation[];
  localeHashes?: Record<string, string>;
  /**
   * 本文の`[[...]]`から導出した派生情報。正本Page YAMLには書き戻さない。
   * dynamic Page APIとstatic Page payloadで同形にする。
   */
  relations?: import("./relations.js").PageRelationsView;
}
