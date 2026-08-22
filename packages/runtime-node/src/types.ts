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
  /** この読み込みで既知として扱ったプラグインのkind */
  knownKinds?: ReadonlySet<string>;
  /** そのうち文書ツリーへ出すkind */
  treeKinds?: ReadonlySet<string>;
  /** 索引行の元になった定義リソースの顔ぶれ。増分読み込みの妥当性判定に使う */
  definitionSignature?: string;
  /**
   * 定義として保持したプラグインリソース。projectorを登録していないkindだけが入る。
   * 数が少ない前提であり、チケット本体のような大量のkindはここに入らない。
   */
  definitionRecords?: import("@vellym/plugin-api").PluginResourceRecord[];
  entryIndex: RepositoryEntryIndex;
  pages: LoadedPage[];
  byName: Map<string, LoadedPage>;
  bySlug: Map<string, LoadedPage>;
  folders: FolderSummary[];
  folderResources: Map<string, LoadedFolder>;
  diagnostics: Diagnostic[];
}

/** 正本YAMLへ書ける値。プラグインが宣言したpathの下だけに書かれる */
export type SpecValue =
  | string
  | number
  | boolean
  | null
  | SpecValue[]
  | { [key: string]: SpecValue };

export interface PagePatch {
  baseHash: string;
  /**
   * プラグインが宣言した項目の書き戻し。`spec`直下からの相対pathで指定する。
   * `null`はキーの削除。`blocks`・`locale`・`translations`は指定できない。
   */
  specValues?: Array<{ path: string[]; value: SpecValue }>;
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
