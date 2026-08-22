import schema from "./plugin-manifest.schema.json" with { type: "json" };
import type { PluginLocalizedText } from "./text.js";

/** manifestを置く`package.json`のフィールド名 */
export const PLUGIN_MANIFEST_FIELD = "vellym";

/**
 * manifestのJSON Schema。hostが検証に使い、プラグイン作者は自分のCIで使える。
 * 同じ定義を`./plugin-manifest.schema.json`のsubpath exportからも取れる。
 */
export const PLUGIN_MANIFEST_SCHEMA: Readonly<Record<string, unknown>> = schema;

/**
 * manifestと`activate`の役割分担。
 *
 * - **manifest**は「何を提供するか」を宣言する。コードを読み込まずに分かる必要が
 *   ある情報だけを書く。版域の判定、ナビゲーション項目の有無、静的版で使えるか、
 *   どのkindを解釈できるかがこれに当たる。
 * - **`activate`**は中身を登録する。schema、列、索引の作り方、コマンドの動作。
 *
 * 同じことを二度書かせないため、manifestには識別子と静的な性質だけを置き、
 * descriptorの実体はmanifestへ書かない。
 */
export interface PluginManifest {
  /** プラグイン識別子。配信path `/plugins/<id>/` に使う。小文字英数と`-`のみ */
  id: string;
  contributes?: PluginContributions;
}

export interface PluginContributions {
  kinds?: readonly PluginManifestKind[];
  views?: readonly PluginManifestView[];
  commands?: readonly PluginManifestCommand[];
  settings?: readonly PluginManifestSetting[];
}

export interface PluginManifestKind {
  kind: string;
  /** 既定は`false`。文書と作業を同じ木に混ぜない場合はそのままにする */
  showInDocumentTree?: boolean;
  /** 既定は`true`。本文を持たない種別は`false`にする */
  hasBlocks?: boolean;
}

export interface PluginManifestView {
  id: string;
  kind: string;
  /** このビューを開く入口になるkind。省略時は`kind`と同じ */
  opensKind?: string;
  type: "list" | "detail";
  /** 静的出力で使えるか。`false`のものは静的版へ出さない */
  static: boolean;
}

export interface PluginManifestCommand {
  id: string;
  title: PluginLocalizedText;
  static: boolean;
  /** 既定は`"view"`。文書階層へ置くものは`"document-tree"` */
  placement?: "view" | "document-tree";
}

export interface PluginManifestSetting {
  id: string;
  label: PluginLocalizedText;
  type: "text" | "number" | "boolean" | "select";
  default?: string | number | boolean;
  options?: readonly { value: string; label: PluginLocalizedText }[];
}

/**
 * プラグインの`package.json`のうち、Vellymが読む範囲。
 *
 * `engines.vellym`は**Vellym本体のversion**の対応域を宣言する。プラグインAPIに
 * 別の版番号は無い。判定はprereleaseを含めて行うため、beta期間中の
 * `0.3.0-beta.1`のようなhost版にも`>=0.3.0-beta.1`が一致する。
 */
export interface PluginPackageManifest {
  name: string;
  version?: string;
  engines?: {
    vellym?: string;
    node?: string;
  };
  vellym: PluginManifest;
}
