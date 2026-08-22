import type {
  PluginDiagnostic,
  PluginDefinitionContext,
  PluginResourceRecord,
  PluginValueType
} from "@vellym/plugin-api";

export const TICKET_KIND = "Ticket";
export const TRACKER_KIND = "TicketTracker";

export interface StatusDefinition {
  id: string;
  label: string;
  category: "open" | "closed";
}

export interface FieldDefinition {
  id: string;
  label: string;
  type: PluginValueType;
  /**
   * 画面から**新しく作るときだけ**入力を強制する。既存チケットの編集も、
   * 手書きのYAMLも止めない。正本がファイルである以上、書き込みを塞ぐ手段が無い。
   */
  required: boolean;
  /** 一覧に列として出すか。宣言が無ければ列にしない */
  listColumn: boolean;
  options?: { value: string; label: string }[];
}

/** チケット管理1式。`TicketTracker`1ファイルから読み取る */
export interface Tracker {
  name: string;
  title: string;
  /** content root相対の、このtrackerが置かれたフォルダ。所属判定に使う */
  folder: string;
  statuses: StatusDefinition[];
  fields: FieldDefinition[];
}

const VALUE_TYPES: PluginValueType[] = [
  "text",
  "multiline",
  "number",
  "boolean",
  "date",
  "select",
  "multiselect",
  "reference"
];

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** `a/b/c.yaml` → `a/b`。content root直下は`""` */
export function folderOf(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? "" : relativePath.slice(0, index);
}

/**
 * チケット管理の対象外にする置き場所か。
 *
 * `_`で始まるフォルダの配下を対象外とする。**残したいが、どの一覧にも出さず、
 * 警告も出したくないチケット**の逃げ道である。ファイルは消さず、全文検索と
 * 内部リンクからは今までどおり到達できる。
 *
 * `_`始まりをこの意味に使うのは、Vellym自身が`_index.yaml`と`_archive/`で既に
 * 「通常の内容ではないもの」の印として使っているためである。Jekyllの`_drafts`、
 * Next.jsやDocusaurusの`_`始まりも同じ慣習にある。設定項目を増やさずに済む。
 *
 * アーカイブ（`_archive/`）もこの規則に含まれる。ただしCoreの走査が`_archive`を
 * 除外するため、実際にはプラグインまで届かない。二重の防御として残す。
 */
export function isExcluded(relativePath: string): boolean {
  return relativePath.split("/").slice(0, -1).some((segment) => segment.startsWith("_"));
}

function readTracker(record: PluginResourceRecord): Tracker {
  const statuses: StatusDefinition[] = [];
  for (const entry of asArray(record.spec.statuses)) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const id = asString(item.id);
    const category = item.category;
    if (!id || (category !== "open" && category !== "closed")) continue;
    statuses.push({ id, label: asString(item.label) ?? id, category });
  }

  const fields: FieldDefinition[] = [];
  for (const entry of asArray(record.spec.fields)) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const id = asString(item.id);
    const type = item.type;
    if (!id || typeof type !== "string" || !VALUE_TYPES.includes(type as PluginValueType)) {
      continue;
    }
    const options: { value: string; label: string }[] = [];
    for (const option of asArray(item.options)) {
      if (typeof option !== "object" || option === null) continue;
      const value = asString((option as Record<string, unknown>).value);
      if (value === undefined) continue;
      options.push({
        value,
        label: asString((option as Record<string, unknown>).label) ?? value
      });
    }
    fields.push({
      id,
      label: asString(item.label) ?? id,
      type: type as PluginValueType,
      required: item.required === true,
      listColumn: item.listColumn === true,
      ...(options.length ? { options } : {})
    });
  }

  return {
    name: record.name,
    title: record.title,
    folder: folderOf(record.relativePath),
    statuses,
    fields
  };
}

/**
 * content root内のチケット管理をすべて読む。
 *
 * 定義側が壊れていても例外にしない。読めた分だけを使い、読めない要素は落とす。
 * 定義が1つ壊れただけでチケット全体が扱えなくなるのを避ける。
 */
export function readTrackers(context: PluginDefinitionContext): Tracker[] {
  return context
    .records(TRACKER_KIND)
    .map(readTracker)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * TicketTracker定義そのものの不整合。チケット1件ごとの投影ではなく、定義を
 * 読み取る時点で1項目につき1回だけ報告する。
 */
export function trackerDefinitionDiagnostics(
  records: readonly PluginResourceRecord[]
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  for (const record of records) {
    const fields = asArray(record.spec.fields);
    fields.forEach((entry, index) => {
      if (typeof entry !== "object" || entry === null) return;
      const item = entry as Record<string, unknown>;
      if (item.type !== "select" && item.type !== "multiselect") return;
      const validOptions = asArray(item.options).filter((option) => {
        if (typeof option !== "object" || option === null) return false;
        return asString((option as Record<string, unknown>).value) !== undefined;
      });
      if (validOptions.length > 0) return;
      const id = asString(item.id);
      diagnostics.push({
        file: record.relativePath,
        path: `/spec/fields/${index}/options`,
        severity: "warning",
        code: "TICKET_FIELD_OPTIONS_MISSING",
        message: `選択式の項目に選択肢がありません${id ? `: ${id}` : ""}`
      });
    });
  }
  return diagnostics;
}

/**
 * チケットの上位にあるチケット管理を、近い順に返す。
 *
 * 先頭が**最も近い祖先**であり、そのチケットの定義を与える所有者になる。
 * 残りは祖先であり、そちらの一覧にも同じチケットが出る。利用者が任意の属性で
 * フォルダ分けしても、上位の一覧から見えなくならないようにするためである。
 */
export function trackersFor(
  trackers: readonly Tracker[],
  relativePath: string
): Tracker[] {
  if (isExcluded(relativePath)) return [];
  const folder = folderOf(relativePath);
  return trackers
    .filter(
      (tracker) =>
        tracker.folder === "" ||
        folder === tracker.folder ||
        folder.startsWith(`${tracker.folder}/`)
    )
    .sort((left, right) => right.folder.length - left.folder.length);
}

/**
 * チケットが属するチケット管理。**最も近い祖先が所有する。**
 *
 * 同じフォルダに複数ある場合は`metadata.name`の昇順で先頭を使う
 * （`readTrackers`が既にその順に並べている）。
 */
export function trackerFor(
  trackers: readonly Tracker[],
  relativePath: string
): Tracker | undefined {
  return trackersFor(trackers, relativePath)[0];
}

export function statusById(
  tracker: Tracker,
  id: string
): StatusDefinition | undefined {
  return tracker.statuses.find((status) => status.id === id);
}

export function fieldById(tracker: Tracker, id: string): FieldDefinition | undefined {
  return tracker.fields.find((field) => field.id === id);
}

/**
 * 項目1つぶんの初期値。**定義の並び順から導く。**
 *
 * 初期値のための宣言（`default`のようなキー）を持たない。並び順と初期値の
 * 2つが同じことを言うと、片方だけ直された状態が生まれる。利用者は
 * 並べ替えることで初期値を変える。
 *
 * `undefined`を返した項目は、生成するYAMLへキーごと書かない。
 * 空文字を入れておくのと「まだ何も入れていない」は別のことである。
 */
export function initialFieldValue(field: FieldDefinition): unknown {
  switch (field.type) {
    case "select":
      return field.options?.[0]?.value;
    case "multiselect":
      return [];
    case "boolean":
      return false;
    default:
      return undefined;
  }
}

/**
 * 新しいチケットの`spec`のうち、定義から決まる部分。
 *
 * ステータスは`statuses`の先頭。定義が空なら書かない。
 */
export function initialTicketSpec(tracker: Tracker | undefined): {
  status?: string;
  fields?: Record<string, unknown>;
} {
  if (!tracker) return {};
  const fields: Record<string, unknown> = {};
  for (const field of tracker.fields) {
    const value = initialFieldValue(field);
    if (value !== undefined) fields[field.id] = value;
  }
  const status = tracker.statuses[0]?.id;
  return {
    ...(status ? { status } : {}),
    ...(Object.keys(fields).length ? { fields } : {})
  };
}
