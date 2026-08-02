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
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface VellymConfig {
  schemaVersion: "1.0";
  contentRoot: string;
  outputDir: string;
  ui: { language: "ja" | "en"; [key: string]: unknown };
  plugins: string[];
  [key: string]: unknown;
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
}

export interface FolderSummary {
  path: string;
  name: string;
  title: string;
  description?: string;
  order: string[];
  readOnly: boolean;
  readOnlyReasons: string[];
}

export interface PageView {
  page: Page;
  knownBlocks: RichTextBlock[];
  relativePath: string;
  hash: string;
  readOnly: boolean;
  readOnlyReasons: string[];
}
