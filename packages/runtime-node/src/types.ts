import type {
  Diagnostic,
  Folder,
  VellymConfig,
  FolderSummary,
  PageView
} from "@vellym-internal/core";
import type { PageEntry, RepositoryEntryIndex } from "./repository-entry.js";

export interface LoadedConfig {
  config: VellymConfig;
  configPath: string;
  projectRoot: string;
  contentRoot: string;
  outputDir: string;
}

export type LoadedPage = PageEntry;

export interface LoadedFolder {
  resource: Folder;
  sourcePath: string;
  summary: FolderSummary;
  hash: string;
}

export interface FolderLocaleChange {
  locale: string;
  operation: "create" | "update";
  baselineHash?: string;
  visibility?: "draft" | "published";
  initialize?:
    | { type: "empty" }
    | { type: "copy"; sourceLocale: string };
  title?: string;
  description?: string | null;
}

export interface FolderPatch {
  folderPath: string;
  baseHash: string | null;
  localeChanges: FolderLocaleChange[];
  removeLocales: string[];
  removeTranslationKeys?: string[];
}

export interface RepositorySnapshot {
  contentRoot: string;
  entryIndex: RepositoryEntryIndex;
  pages: LoadedPage[];
  byName: Map<string, LoadedPage>;
  bySlug: Map<string, LoadedPage>;
  folders: FolderSummary[];
  folderResources: Map<string, LoadedFolder>;
  diagnostics: Diagnostic[];
}

export interface PagePatch {
  baseHash: string;
  title?: string;
  slug?: string;
  richTextBlocks?: Array<{ id: string; content: string }>;
  localeChanges?: LocaleChange[];
  removeLocales?: string[];
  removeTranslationKeys?: string[];
}

export interface LocaleChange {
  locale: string;
  operation: "create" | "update";
  baselineHash?: string;
  visibility?: "draft" | "published";
  initialize?:
    | { type: "empty" }
    | { type: "copy"; sourceLocale: string };
  title?: string;
  richTextBlocks?: Array<{ id: string; content: string }>;
}
