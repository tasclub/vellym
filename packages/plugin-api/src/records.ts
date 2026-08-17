import type { PluginDiagnostic } from "./diagnostics.js";

/**
 * プラグインが受け取る、抽出済みのリソース1件。
 *
 * **ファイルシステムもcontent rootのpathも渡さない。** プラグインが読むのは
 * Coreが抽出したこのレコードだけである。`relativePath`は表示と診断のための
 * content root相対の文字列であり、これを使ってファイルを開くことはできない。
 */
export interface PluginResourceRecord {
  kind: string;
  /** 不変の機械ID。全kind横断で一意であり、内部リンクの解決先でもある */
  name: string;
  title: string;
  slug?: string;
  /** content root相対path。表示と診断にだけ使う */
  relativePath: string;
  /** 正本の言語 */
  locale?: string;
  labels?: Readonly<Record<string, string>>;
  annotations?: Readonly<Record<string, string>>;
  /**
   * 種別固有データ。Coreが解釈していない原文である。
   *
   * プラグインが解釈しないフィールドもここに含まれる。書き換えても正本には
   * 影響しない。保存はCoreの保存経路（コマンド）を通した場合だけ行われる。
   */
  spec: Readonly<Record<string, unknown>>;
  readOnly: boolean;
}

/** 索引行に置ける値。絞り込みと並べ替えの対象になる */
export type PluginIndexValue = string | number | boolean | null | readonly string[];

/**
 * 抽出済みレコードから作る、種別固有の索引行。
 *
 * 一覧の絞り込みと並べ替えはこの行だけで行う。`spec`全体を常駐させないための
 * 仕組みであり、**返した値以外はレコードごと破棄される**。
 */
export interface PluginRecordProjection {
  /** 列IDから値への対応 */
  values: Readonly<Record<string, PluginIndexValue>>;
  /** 定義との食い違い。エラーにせず注意として利用者へ示す */
  diagnostics?: readonly PluginDiagnostic[];
}

/**
 * レコード1件を索引行へ落とす関数。リソースの読み込み中に1回だけ呼ばれる。
 *
 * **引数の`record`を保持してはならない。** 参照を残すと、20,000件のチケットの
 * `spec`が丸ごと常駐する。必要な値は`values`へ複写して返す。
 *
 * `undefined`を返すと、そのレコードは索引に載らない。
 */
export type PluginRecordProjector = (
  record: PluginResourceRecord
) => PluginRecordProjection | undefined;

/**
 * projectorを作る関数。`registerRecordProjection`へ渡すのはこちらである。
 *
 * projector自身はレコード1件ずつを高頻度で呼ばれるため、利用者の定義に依存する
 * 解決はここで1回だけ済ませる。hostは**定義リソースを先に読み終えてから**
 * この関数を呼ぶので、`context.records()`はprojectorが1件も呼ばれる前に
 * 解決済みである。
 *
 * 定義を見ないプラグインは`() => (record) => ...`と書く。
 */
export type PluginRecordProjectorFactory = (
  context: import("./views.js").PluginDefinitionContext
) => PluginRecordProjector;

/** 新しいリソースを作る指示。Coreの保存経路を通して正本YAMLになる */
export interface PluginResourceDraft {
  kind: string;
  /** 省略するとCoreが生成する。プラグインが規則を持つ場合だけ指定する */
  name?: string;
  title: string;
  /** content root相対のフォルダ。省略時はcontent root直下 */
  folder?: string;
  spec: Readonly<Record<string, unknown>>;
}
