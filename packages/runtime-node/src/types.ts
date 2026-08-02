import type {
  Diagnostic,
  VellymConfig,
  FolderSummary,
  PageView
} from "@vellym-internal/core";

export interface LoadedConfig {
  config: VellymConfig;
  configPath: string;
  projectRoot: string;
  contentRoot: string;
  outputDir: string;
}

export interface LoadedPage {
  view: PageView;
  sourcePath: string;
}

export interface RepositorySnapshot {
  pages: LoadedPage[];
  byName: Map<string, LoadedPage>;
  bySlug: Map<string, LoadedPage>;
  folders: FolderSummary[];
  diagnostics: Diagnostic[];
}

export interface PagePatch {
  baseHash: string;
  title?: string;
  slug?: string;
  richTextBlocks?: Array<{ id: string; content: string }>;
}
