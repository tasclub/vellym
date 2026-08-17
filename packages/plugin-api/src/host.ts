import type { PluginDiagnostic } from "./diagnostics.js";
import type {
  PluginRecordProjectorFactory,
  PluginResourceDraft
} from "./records.js";
import type { PluginResourceRecord } from "./records.js";
import type { PluginLocalizedText } from "./text.js";
import type { PluginIndexValue } from "./records.js";
import type {
  PluginDefinitionContext,
  PluginFieldDescriptor,
  PluginViewContext,
  PluginViewProvider
} from "./views.js";

/**
 * コマンドの入力にできる値。型ごとの入力欄をhostが出し、その型のまま渡す。
 *
 * すべてを文字列にすると、真偽値の「false」と未入力、数値の「0」と空欄が
 * プラグイン側で区別できなくなる。
 */
export type PluginInputValue = string | number | boolean | readonly string[];

/**
 * コマンドが起こす前に尋ねる入力欄。
 *
 * 詳細の項目と同じ宣言を使い、初期値だけを足す。初期値は**プラグインが
 * その場で決めて渡す**。hostが定義を読んで推測しない。
 */
export interface PluginCommandInput extends PluginFieldDescriptor {
  initialValue?: PluginInputValue;
}

/**
 * 入力欄の宣言。開いている対象によって変わる場合は関数で渡す。
 *
 * 「そのチケット管理が必須と定めた項目だけを尋ねる」のように、対象が
 * 決まってはじめて何を尋ねるかが決まる場合がある。
 */
export type PluginCommandInputsProvider =
  | readonly PluginCommandInput[]
  | ((context: PluginViewContext) => readonly PluginCommandInput[]);

/**
 * 種別ごとのアイコン。
 *
 * **16×16のviewBoxへ描くpathの`d`だけを受け取る。** SVGの断片を文字列で
 * 受けて差し込む形にしない。任意のmarkupをhostのDOMへ入れる口を開けないため
 * である。線は`currentColor`で描かれ、周りの文字色に従う。
 *
 * **hostは種別名からアイコンを推測しない。** 渡されなければ既定の印を使う。
 * Coreがドメインごとのアイコン集合を先回りして持ち続ける形にもしない。
 */
export interface PluginKindIcon {
  paths: readonly string[];
  /** 塗りで描くか。既定は線画（`false`） */
  filled?: boolean;
}

/** kindの登録 */
export interface PluginKindContribution {
  kind: string;
  /**
   * 種別固有`spec`のJSON Schema。省略すると共通契約の範囲だけを検証する。
   *
   * schemaに合わないリソースは**エラーにならない**。警告として示し、読める
   * ものとして扱う。定義を1つ変えただけで大量のリソースが編集不能になるのを
   * 避けるためである。
   */
  specSchema?: Readonly<Record<string, unknown>>;
  /**
   * 文書ツリーへ出すか。既定は`false`。
   * 文書と作業を同じ木に混ぜない場合は`false`のままにする。
   */
  showInDocumentTree?: boolean;
  /** `spec.blocks`を本文として扱うか。既定は`true` */
  hasBlocks?: boolean;
  /**
   * 文書ツリーと一覧で使うアイコン。省略すると既定の印で出る。
   * `showInDocumentTree`が`false`の種別でも、詳細の見出しなどで使われる。
   */
  icon?: PluginKindIcon;
}

/** ビューの登録 */
export interface PluginViewContribution {
  id: string;
  view: PluginViewProvider;
  /**
   * このビューを開く入口になるリソースのkind。
   *
   * 利用者がそのkindのリソースを開いたとき、本文の代わりにこのビューを描く。
   * 一覧の**行**のkind（descriptorの`kind`）とは別であることに注意する。
   * 「チケット管理を開くとチケットの一覧になる」なら、descriptorの`kind`は
   * `Ticket`、`opensKind`は`TicketTracker`である。
   *
   * 省略するとdescriptorの`kind`と同じにする。
   */
  opensKind?: string;
  /**
   * 静的出力で使えるか。`false`のものは静的版へ**出さない**。
   * disabledで残さない。
   */
  static: boolean;
  /**
   * 同じkindの別のビューへ切り替える導線に使う表示名。
   * 省略すると導線を出さない。hostが名前を推測しない。
   */
  label?: PluginLocalizedText;
}

/** コマンドの登録 */
export interface PluginCommandContribution {
  id: string;
  title: PluginLocalizedText;
  /** 静的出力で使えるか。作成・保存系は`false`にする */
  static: boolean;
  /**
   * どこから起こせるか。既定は`"view"`（そのプラグインのビューの中）。
   *
   * `"document-tree"`は、文書ツリーの追加メニューへ並べる。**そこで作るものが
   * 文書階層に置かれる場合だけ**指定する。作成先のフォルダは`input.folder`で渡る。
   */
  placement?: "view" | "document-tree";
  /**
   * 起こす前に利用者へ尋ねる入力。宣言するとhostが同じ汎用レンダラで
   * 入力欄を出し、`PluginCommandContext.input`へ渡す。
   *
   * 作成コマンドがタイトルと必須項目を尋ねる、といった用途である。
   * 宣言しなければ確認なしで実行される。
   *
   * `required`の入力欄は**このコマンドの実行だけを止める。** 既にあるリソースの
   * 編集も、手で書いたYAMLも止めない。塞げないものを塞げるふりをしない。
   */
  inputs?: PluginCommandInputsProvider;
  run(context: PluginCommandContext): Promise<PluginCommandResult> | PluginCommandResult;
}

export interface PluginCommandContext extends PluginDefinitionContext {
  locale: string;
  /**
   * `inputs`で宣言した項目に、利用者が入れた値。IDから値への対応。
   * 宣言した`type`のままの値が入る。文字列へ潰さない。
   */
  input?: Readonly<Record<string, PluginInputValue>>;
  /**
   * 操作対象のリソース。一覧・詳細から起動した場合に入る。
   * `PluginViewContext.target`と同じもので、どの文脈で起こされたかを示す。
   */
  target?: PluginResourceRecord;
  /**
   * 正本YAMLを作る。**Coreの保存経路を通る。** 非破壊往復、realpath境界、
   * hash競合検出はこの経路でも同じく効く。
   */
  createResource(draft: PluginResourceDraft): Promise<PluginCommandResult>;
}

export type PluginCommandResult =
  | {
      ok: true;
      name: string;
      /**
       * 作った直後に開くビュー。省略すると既定のビューを開く。
       *
       * 作成直後に設定を促したい場合に使う。どこへ連れて行くかを
       * hostが推測しない。
       */
      openView?: string;
    }
  | { ok: false; diagnostics: readonly PluginDiagnostic[] };

/**
 * Node側の`activate(host)`が受け取るhost。
 *
 * **登録関数だけを持つ。** ファイルシステム、content rootのpath、Coreの内部
 * モジュールは渡さない。プラグインが読むのは抽出済みレコードだけである。
 */
export interface VellymPluginHost {
  readonly pluginId: string;
  /** 実行中のVellym本体のversion。`engines.vellym`の判定は読み込み前に済んでいる */
  readonly hostVersion: string;
  registerKind(contribution: PluginKindContribution): void;
  registerView(contribution: PluginViewContribution): void;
  registerCommand(contribution: PluginCommandContribution): void;
  /**
   * 抽出済みレコードから種別固有の索引行を作る関数を登録する。
   * 一覧の絞り込みと並べ替えはこの索引だけで行う。
   *
   * 渡すのは**projectorを作る関数**であり、projectorそのものではない。
   * 何を索引に載せるかが利用者の定義で決まる場合に、定義の解決を
   * レコード1件ごとに繰り返させないためである。定義を見ないプラグインは
   * `() => (record) => ...`と書けばよい。受け口を1つに保つ。
   */
  registerRecordProjection(kind: string, createProjector: PluginRecordProjectorFactory): void;
  /**
   * 利用者へ診断を出す。例外を投げる代わりにこれを使う。
   * 例外は握られて診断になるが、そのとき位置情報は残らない。
   */
  reportDiagnostic(diagnostic: PluginDiagnostic): void;
}

/**
 * Node側エントリが満たす形。`package.json`の`exports`の`node`条件が指す
 * モジュールが、これをexportする。
 */
export interface VellymPluginModule {
  activate(host: VellymPluginHost): void | Promise<void>;
}

/**
 * mountが返す取っ手。hostはこれを持ち続け、文脈が変わるたびに`update`を、
 * 画面を閉じるときに`unmount`を呼ぶ。
 */
export interface PluginViewHandle {
  /**
   * 文脈が変わったときに呼ばれる。locale、`target`、`isStatic`のいずれかが
   * 変わった場合である。
   *
   * **省略してよい。** 省略した場合、hostは`unmount`してから新しい要素へ
   * `mount`し直す。`update`は描き直しを避けるための最適化であり、
   * 無くても正しく動く。
   */
  update?(context: PluginRenderContext): void;
  /**
   * 画面を閉じるときに呼ばれる。**同期で片づける。**
   *
   * hostはこの呼び出しの直後に要素を捨て、戻り値を待たない。timerや購読は
   * ここで止める。後から解決する非同期処理が要素へ触れないようにするのは
   * プラグインの責任である。
   */
  unmount(): void;
}

/** 正本へ書き戻す1件。`spec`直下からのpathと、書き込む値 */
export interface PluginSpecWrite {
  path: readonly string[];
  value: unknown;
}

export type PluginSaveResult =
  | { ok: true }
  /** 競合や検証の失敗。利用者へ見せる1行を持つ */
  | { ok: false; message: string };

/** 索引行1件。**`spec`は持たない。** 一覧の絞り込みと数え上げに使う */
export interface PluginIndexRow {
  name: string;
  title: string;
  values: Readonly<Record<string, PluginIndexValue>>;
}

/**
 * rendererが受け取る文脈。宣言の文脈に、**書き戻す手段**と
 * **数え上げの材料**を足したものである。
 *
 * 宣言（descriptor）だけで描く画面は`PluginViewContext`のままでよい。
 * こちらは「宣言では表せない画面」を自分で描くときに使う。
 */
export interface PluginRenderContext extends PluginViewContext {
  /**
   * 開いているリソースの正本へ書き戻す。
   *
   * **Coreの保存経路を通る。** 非破壊往復、realpath境界、hash競合の検出は
   * この経路でも同じく効く。プラグインが独自にファイルへ書く口は開けない。
   *
   * 静的出力では常に失敗する。`isStatic`を見て操作自体を出さないこと。
   */
  save(writes: readonly PluginSpecWrite[]): Promise<PluginSaveResult>;
  /**
   * 一覧に載る索引行。**使用中の値の件数を数えるために渡す。**
   *
   * 「このステータスを使っているチケットが3件あります」を出せるようにする。
   * 完全なリソースは渡さない。数えるのに`spec`は要らない。
   */
  rows: readonly PluginIndexRow[];
}

/**
 * ブラウザ側で画面を描く実体。**技術を選ばない。**
 *
 * 契約パッケージはReactへ依存しないため、React固有の型を参照しない。
 * Vanilla、Svelte、Vue、Preactのいずれでも書ける。Reactで書く作者は
 * `@vellym/plugin-api/react`の`reactRenderer`でcomponentを包む。
 *
 * ## 呼び分けの規約
 *
 * - `mount`は1つの取っ手につき**1回だけ**呼ばれる。hostは渡す前に要素を
 *   空にする。要素の中身はプラグインのものであり、hostは触らない。
 * - 描き直しが必要になったときは、hostが`unmount`してから**新しい要素へ**
 *   `mount`する。同じ取っ手へ`mount`し直すことはない。
 * - `update`は`unmount`より後には呼ばれない。解体中のupdateをプラグイン側で
 *   防ぐ必要は無い。
 * - `mount`は同期で取っ手を返す。読み込み待ちがある場合は、先に待機中の
 *   表示を描いてから中で非同期に差し替える。
 * - `mount`／`update`／`unmount`が例外を投げた場合、hostが受け止めて
 *   その画面の位置へ診断を出す。文書ツリー、全文検索、本文の編集は
 *   引き続き使える。
 */
export interface PluginViewRenderer {
  mount(element: HTMLElement, context: PluginRenderContext): PluginViewHandle;
}

/**
 * ブラウザ側の`activate(host)`が受け取るhost。
 *
 * 宣言で表現できる画面はdescriptorだけで描かれるため、多くのプラグインは
 * ブラウザ側エントリを持たなくてよい。
 */
export interface VellymBrowserPluginHost {
  readonly pluginId: string;
  readonly hostVersion: string;
  /** 宣言で表現できない画面にだけ使う */
  registerViewRenderer(viewId: string, renderer: PluginViewRenderer): void;
}

export interface VellymBrowserPluginModule {
  activate(host: VellymBrowserPluginHost): void | Promise<void>;
}

/** Node側エントリの型を固定するための恒等関数 */
export function definePlugin(module: VellymPluginModule): VellymPluginModule {
  return module;
}

/** ブラウザ側エントリの型を固定するための恒等関数 */
export function defineBrowserPlugin(
  module: VellymBrowserPluginModule
): VellymBrowserPluginModule {
  return module;
}
