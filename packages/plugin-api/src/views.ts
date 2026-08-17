import type { PluginIndexValue, PluginResourceRecord } from "./records.js";
import type { PluginLocalizedText } from "./text.js";

/**
 * 汎用レンダラが扱える値の型。
 *
 * プラグインは自前の入力欄を作らず、この型のどれかを宣言する。アクセシビリティ、
 * 日英表示、キーボード操作、静的版での動作は、既存のレンダラ側で担保される。
 */
export type PluginValueType =
  | "text"
  | "multiline"
  | "number"
  | "boolean"
  /** `YYYY-MM-DD`の文字列。YAMLの日付型は使わない（パーサとタイムゾーンの解釈差を避ける） */
  | "date"
  | "select"
  | "multiselect"
  /** 参照先の`metadata.name`。内部リンクと同じ解決先 */
  | "reference";

export interface PluginSelectOption {
  value: string;
  label: PluginLocalizedText;
  /**
   * 表示名の前に置く記号。`□`、`✓`、`△`のような1文字を想定する。
   *
   * 状態を**色だけで伝えないため**にある。記号と文言の両方を出す。
   * **hostが記号を推測しない。** どの値がどの記号にあたるかを知っているのは
   * プラグインだけである。読み上げには表示名だけが載る。
   */
  symbol?: string;
}

/** 一覧の列 */
export interface PluginColumnDescriptor {
  id: string;
  label: PluginLocalizedText;
  /** 索引行のキー。省略時は`id`と同じ */
  valueKey?: string;
  type?: PluginValueType;
  options?: readonly PluginSelectOption[];
  sortable?: boolean;
  filterable?: boolean;
  /**
   * 副次的な情報として1行へ畳む列。20,000件が入りうる一覧で、行を縦に
   * 積み上げないための指定である。
   */
  secondary?: boolean;
  /**
   * 選んだ行へまとめて書き込むときの`spec`内の位置。宣言した列だけが
   * 一括編集の対象になる。
   *
   * **hostが「選択肢がある列なら一括できる」と推測しない。** 同じ値を大量の
   * リソースへ書く操作は取り消しにくく、どこまでを許すかはプラグインが決める。
   * 自由入力の項目には宣言しない。
   */
  editPath?: readonly string[];
}

export type PluginFilterOperator =
  | "equals"
  | "in"
  /**
   * 列挙した値の**どれでもない**。
   *
   * 「既定では完了を出さない」のような条件は、含めるものを数え上げるのではなく
   * 除くものを数え上げる。値が未設定のもの、定義から外れたものが、
   * 数え上げ漏れで一覧から消えるのを避ける。
   */
  | "not-in"
  | "contains"
  | "exists";

export interface PluginFilterDescriptor {
  columnId: string;
  operator: PluginFilterOperator;
  value?: PluginIndexValue;
  /**
   * 外せる切替として画面に出すときの文言。`defaultFilters`へ付けたときだけ使う。
   * 省略すると切替を出さず、外せない絞り込みになる。
   *
   * **効いているときと外したときの両方を宣言する。** 押した結果どうなるかではなく、
   * **いま何が表示されているか**を書く。切替は押しても位置も形も変わらないため、
   * 文言が変わらないと入と切のどちらなのか読めない。
   *
   * **hostが文言を持たない。** 「未完了のみ」のような語は、その種別を知る
   * プラグインだけが正しく書ける。
   */
  toggleLabels?: {
    /** 絞り込みが効いているとき（例: 「未完了のみ」） */
    applied: PluginLocalizedText;
    /** 外したとき（例: 「すべて表示中」） */
    cleared: PluginLocalizedText;
  };
}

export interface PluginSortDescriptor {
  columnId: string;
  direction: "asc" | "desc";
}

/** 一覧ビュー */
export interface PluginListViewDescriptor {
  type: "list";
  id: string;
  kind: string;
  title: PluginLocalizedText;
  columns: readonly PluginColumnDescriptor[];
  defaultSort?: PluginSortDescriptor;
  /**
   * この一覧に出る集合そのものを決める絞り込み。**利用者が外せない。**
   * 「この一覧に出るのはこのチケット管理に属するものだけ」のような、
   * 一覧の同一性に関わる条件をここへ置く。
   */
  scopeFilters?: readonly PluginFilterDescriptor[];
  /**
   * 初期表示の絞り込み。利用者が外せる。既定で未完了だけを見せるといった
   * 見せ方の初期値をここへ置く。変えた値は個人設定として保持され、正本へは書かない。
   */
  defaultFilters?: readonly PluginFilterDescriptor[];
  /**
   * 1件も無いときの誘導。エラー画面にしない。定義リソースが無い状態も
   * ここで扱う（一覧は出し、定義の作成へ誘導する）。
   */
  emptyState?: {
    message: PluginLocalizedText;
    commandId?: string;
  };
}

/** 詳細ビューの項目 */
export interface PluginFieldDescriptor {
  id: string;
  label: PluginLocalizedText;
  type: PluginValueType;
  /**
   * `spec`内の位置。`["status"]`、`["fields", "priority"]`のように書く。
   * 保存時はこのpathへ書き戻される。
   */
  path: readonly string[];
  /**
   * 現在値を読む索引行のキー。省略すると`id`を使う。
   *
   * projectorが付けたキーと項目の`id`が違う場合に宣言する。**hostは`path`から
   * キーを組み立てない。** 組み立てると、あるプラグインの命名規約が汎用の
   * レンダラへ染み出す。
   */
  valueKey?: string;
  options?: readonly PluginSelectOption[];
  required?: boolean;
  /**
   * 定義に無い項目や、型が定義と合わない値に付ける。値は保持したまま
   * 読み取り専用で見せる。**勝手に消さない。**
   */
  readOnly?: boolean;
  description?: PluginLocalizedText;
}

/**
 * 繰り返し構造の項目。同じ形の要素を利用者が増減する。
 *
 * 「項目の定義そのものを増減する」ような画面は、項目を並べるだけの宣言では
 * 表せない。配列の要素に何を書くかを宣言し、追加と削除はレンダラが受け持つ。
 */
export interface PluginGroupFieldDescriptor {
  id: string;
  label: PluginLocalizedText;
  type: "group";
  /** `spec`内の配列の位置 */
  path: readonly string[];
  /** 各要素が持つ項目。入れ子のgroupは持てない */
  fields: readonly PluginFieldDescriptor[];
  addLabel?: PluginLocalizedText;
  description?: PluginLocalizedText;
}

/** 詳細ビュー */
export interface PluginDetailViewDescriptor {
  type: "detail";
  id: string;
  kind: string;
  fields: readonly (PluginFieldDescriptor | PluginGroupFieldDescriptor)[];
  /**
   * 説明本文の扱い。`"blocks"`にすると、通常のPage編集と同じエディタと
   * 同じ保存経路を使う。未保存離脱の保護、保存失敗時の入力保持、外部変更と
   * 競合からの復旧もそのまま働く。専用の仕組みを作らない。
   */
  body: "blocks" | "none";
  /**
   * `fields`のどれにも当てはまらない`spec`の値をどうするか。既定は`"read-only"`。
   *
   * descriptorはkind単位、値はリソース単位であるため、「利用者が定義を消した後も
   * 個々のリソースに残っている値」をdescriptorへ列挙できない。宣言で表現できない
   * この差を、レンダラ側の規則として宣言する。
   *
   * `"read-only"`は値を保持したまま読み取り専用で見せる。`"hidden"`は出さない。
   * **どちらも値を消さない。** 表示しないことと削除することを混同しない。
   */
  undeclaredFields?: "read-only" | "hidden";
  /**
   * 未宣言として見せる索引行キーの接頭辞。省略すると未宣言を1つも出さない。
   *
   * 索引行には`tracker`のような、利用者へ見せる意味を持たないキーも入る。
   * どこからが「利用者が定義した項目」かはプラグインしか知らない。
   * **hostが接頭辞を推測しない。**
   */
  undeclaredKeyPrefix?: string;
  /**
   * この詳細の親にあたるリソース。保存後や「戻る」の行き先になる。
   *
   * 詳細はkind単位のdescriptorだが、親はリソースごとに変わる。開いている
   * リソースから解決した結果をここへ入れる。
   */
  parent?: { name: string; title: PluginLocalizedText };
}

export type PluginViewDescriptor =
  | PluginListViewDescriptor
  | PluginDetailViewDescriptor;

/**
 * 利用者が正本YAMLへ書いた定義を読むための文脈。
 *
 * ステータスや項目のように、**何を索引に載せるか・何を画面に出すかが
 * 利用者の定義で決まる**プラグインのために用意する。定義は正本YAMLなので、
 * 読み込みのたびに解決し直され、定義を変えれば反映される。
 */
export interface PluginDefinitionContext {
  /**
   * 指定kindのレコードを返す。
   *
   * **定義リソースのような少数の集合にだけ使う。** チケット本体のような
   * 大量のkindへ使うと、`spec`が丸ごと常駐する。一覧の元データは
   * `registerRecordProjection`で作る索引行であり、この関数ではない。
   */
  records(kind: string): readonly PluginResourceRecord[];
}

/** descriptorを組み立てるときにCoreが渡す文脈 */
export interface PluginViewContext extends PluginDefinitionContext {
  /** 表示locale */
  locale: string;
  /** 静的出力の生成中か。`true`のとき編集系の宣言は出力されない */
  isStatic: boolean;
  /**
   * いま開いているリソース。一覧なら一覧の元になるリソース、詳細なら表示中の
   * リソースが入る。開く対象が決まっていない場合は`undefined`。
   *
   * 同じkindでも**リソースごとにdescriptorが変わる**場合に使う。利用者が
   * 複数の定義リソースを別々の場所へ置き、それぞれ違う列や入力欄になる構成が
   * これに当たる。descriptorはkind単位、実データはリソース単位という差を、
   * ここで埋める。
   */
  target?: PluginResourceRecord;
}

/** descriptorそのもの、または文脈から組み立てる関数 */
export type PluginViewProvider =
  | PluginViewDescriptor
  | ((context: PluginViewContext) => PluginViewDescriptor);
