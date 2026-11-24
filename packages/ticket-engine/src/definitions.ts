import { SUMMARY_METHODS, type SummaryMethod } from "@vellym/plugin-api";
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
  /**
   * 絞り込みの対象にするか。**実効値**であり、宣言を省略した場合は
   * `listColumn`と同じになる（列に出す項目は絞り込みにも出てしかるべき、
   * という既定である）。
   */
  filter: boolean;
  /** 並べ替えの対象にするか。実効値で、省略時は`listColumn`と同じ */
  sort: boolean;
  options?: { value: string; label: string }[];
  /**
   * 参照の複数値。**reference専用**で、trueなら値は文字列の配列になる。
   * 他の型で宣言しても無効化し、`TICKET_FIELD_MULTIPLE_UNSUPPORTED`を出す。
   */
  multiple: boolean;
}

type RuleValue = string | number | boolean;
export interface TrackerRule {
  id: string;
  when?: { status?: string[]; statusCategory?: "open" | "closed" };
  require?: string[];
  empty?: string[];
  equals?: Record<string, RuleValue | RuleValue[]>;
  message?: Record<string, string>;
}

function parseRule(raw: unknown, index: number, statuses: StatusDefinition[], fields: FieldDefinition[]): TrackerRule | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const map = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const ids = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string" && x !== "status" && fields.some(f => f.id === x));
  const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  if (r.id !== undefined && typeof r.id !== "string") return undefined;
  if (r.when !== undefined) {
    if (!map(r.when)) return undefined;
    if (r.when.status !== undefined && (!Array.isArray(r.when.status) || !r.when.status.every(x => typeof x === "string" && statuses.some(s => s.id === x)))) return undefined;
    if (r.when.statusCategory !== undefined && r.when.statusCategory !== "open" && r.when.statusCategory !== "closed") return undefined;
  }
  if (r.require === undefined && r.empty === undefined && r.equals === undefined) return undefined;
  if (r.require !== undefined && !ids(r.require) || r.empty !== undefined && !ids(r.empty)) return undefined;
  if (r.equals !== undefined && (!map(r.equals) || !Object.entries(r.equals).every(([id, value]) => ids([id]) && (Array.isArray(value) ? value.length > 0 && value.every(scalar) : scalar(value))))) return undefined;
  if (r.message !== undefined && (!map(r.message) || !Object.values(r.message).every(v => typeof v === "string"))) return undefined;
  return { ...r, id: typeof r.id === "string" ? r.id : `rules[${index}]` } as unknown as TrackerRule;
}

/** 一覧を開いたときの並べ替え。`TicketTracker`の`spec.defaultSort` */
export interface DefaultSortDefinition {
  /** 解決済みの項目定義。存在しない項目や`sort`が無効な項目は入らない */
  field: FieldDefinition;
  direction: "asc" | "desc";
}

/** チケット管理1式。`TicketTracker`1ファイルから読み取る */
export interface Tracker {
  name: string;
  title: string;
  /** content root相対の、このtrackerが置かれたフォルダ。所属判定に使う */
  folder: string;
  statuses: StatusDefinition[];
  fields: FieldDefinition[];
  rules?: TrackerRule[];
  ticketTemplate?: string | Record<string, string>;
  summary?: { field: FieldDefinition; method: SummaryMethod; groupBy?: FieldDefinition }[];
  /**
   * 一覧を開いたときの既定の並べ替え。`spec.defaultSort`。
   *
   * 定義から解決できたときだけ入る。存在しない項目や`sort`が無効な項目は
   * 入らず、定義の不整合として警告する（一覧は今までどおり開く）。
   */
  defaultSort?: DefaultSortDefinition;
  /** Tracker-selected reference field; never a fixed Ticket.spec.parent. */
  parentField?: string;
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

function readTemplate(value: unknown): string | Record<string, string> | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([, text]) => typeof text !== "string")) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
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
    const field = parseFieldDefinition(entry as Record<string, unknown>);
    if (field) fields.push(field);
  }

  const rawDefaultSort = record.spec.defaultSort;
  const defaultSort = typeof rawDefaultSort === "object" && rawDefaultSort !== null && !Array.isArray(rawDefaultSort)
    ? resolveDefaultSort(rawDefaultSort as Record<string, unknown>, fields)
    : undefined;

  const rawHierarchy = record.spec.hierarchy;
  const hierarchy = typeof rawHierarchy === "object" && rawHierarchy !== null && !Array.isArray(rawHierarchy)
    ? rawHierarchy as Record<string, unknown> : {};
  const parentField = typeof hierarchy.parentField === "string" &&
    fields.some((field) => field.id === hierarchy.parentField && field.type === "reference" && !field.multiple)
    ? hierarchy.parentField : undefined;
  const ticketTemplate = readTemplate(record.spec.ticketTemplate);

  return {
    name: record.name,
    title: record.title,
    folder: folderOf(record.relativePath),
    statuses,
    fields,
    ...(Array.isArray(record.spec.rules) ? { rules: record.spec.rules.flatMap((r, i) => { const rule = parseRule(r, i, statuses, fields); return rule ? [rule] : []; }) } : {}),
    ...(Array.isArray(record.spec.summary) ? { summary: record.spec.summary.flatMap((raw) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
      const entry = raw as Record<string, unknown>;
      const field = fields.find((item) => item.id === entry.field);
      const groupBy = fields.find((item) => item.id === entry.groupBy && ["select", "multiselect", "reference", "text"].includes(item.type));
      return field && (entry.groupBy === undefined || groupBy) && typeof entry.method === "string" && SUMMARY_METHODS[field.type].includes(entry.method as SummaryMethod)
        ? [{ field, method: entry.method as SummaryMethod, ...(groupBy ? { groupBy } : {}) }] : [];
    }) } : {}),
    ...(ticketTemplate !== undefined ? { ticketTemplate } : {}),
    ...(defaultSort ? { defaultSort } : {}),
    ...(parentField ? { parentField } : {})
  };
}

/**
 * `spec.fields`の1項目を読む。
 *
 * `filter`と`sort`はここで**実効値**を決める（宣言を省略すれば`listColumn`と同じ）。
 * 項目を使う側が既定を繰り返すと、片方だけ直された状態が生まれるため、
 * 判定は definitions.ts の中に閉じる。
 */
function parseFieldDefinition(item: Record<string, unknown>): FieldDefinition | undefined {
  const id = asString(item.id);
  const type = item.type;
  if (!id || typeof type !== "string" || !VALUE_TYPES.includes(type as PluginValueType)) {
    return undefined;
  }
  const listColumn = item.listColumn === true;
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
  return {
    id,
    label: asString(item.label) ?? id,
    type: type as PluginValueType,
    required: item.required === true,
    listColumn,
    filter: typeof item.filter === "boolean" ? item.filter : listColumn,
    sort: typeof item.sort === "boolean" ? item.sort : listColumn,
    ...(options.length ? { options } : {}),
    // reference専用の修飾。他の型で宣言してもここではfalseにし、diagnosticsで警告する
    multiple: type === "reference" && item.multiple === true
  };
}

/**
 * `spec.defaultSort`を項目定義に解決する。項目が存在しない、`sort`が無効、
 * 方式がasc/descでない場合は`undefined`（警告は`trackerDefinitionDiagnostics`）。
 * 宣言の時点では項目IDの文字列なので、解決済み定義を載せる場所への変換もここで行う。
 */
function resolveDefaultSort(
  item: Record<string, unknown>,
  fields: FieldDefinition[]
): DefaultSortDefinition | undefined {
  const fieldId = asString(item.field);
  if (!fieldId) return undefined;
  const field = fields.find((candidate) => candidate.id === fieldId);
  if (!field || !field.sort) return undefined;
  if (item.direction === undefined) return { field, direction: "asc" };
  if (item.direction !== "asc" && item.direction !== "desc") return undefined;
  return { field, direction: item.direction };
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
    if (record.spec.ticketTemplate !== undefined && readTemplate(record.spec.ticketTemplate) === undefined) {
      diagnostics.push({ file: record.relativePath, path: "/spec/ticketTemplate", severity: "warning",
        code: "TICKET_TEMPLATE_INVALID", message: {
          ja: "本文テンプレートには文字列または言語別の文字列を指定してください",
          en: "The ticket template must be a string or a map of localized strings."
        } });
    }
    const parsed = readTracker(record);
    if (record.spec.rules !== undefined) {
      const rules = Array.isArray(record.spec.rules) ? record.spec.rules : [record.spec.rules];
      rules.forEach((rule, index) => {
        if (!Array.isArray(record.spec.rules) || !parseRule(rule, index, parsed.statuses, parsed.fields)) diagnostics.push({
          file: record.relativePath, path: `/spec/rules/${index}`, severity: "warning", code: "TICKET_RULE_INVALID",
          message: { ja: "条件ルールの定義を確認してください", en: "Check the conditional rule definition." }
        });
      });
    }
    const fields = asArray(record.spec.fields);
    if (record.spec.summary !== undefined) {
      if (!Array.isArray(record.spec.summary)) {
        diagnostics.push({ file: record.relativePath, path: "/spec/summary", severity: "warning", code: "TICKET_SUMMARY_INVALID", message: { ja: "集計は項目と方式の配列で指定してください", en: "Summaries must be an array of fields and methods." } });
      } else record.spec.summary.forEach((raw, index) => {
        const entry = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        const field = fields.find((value) => typeof value === "object" && value !== null && (value as Record<string, unknown>).id === entry.field) as Record<string, unknown> | undefined;
        const type = field?.type as PluginValueType;
        const group = fields.find((value) => typeof value === "object" && value !== null && (value as Record<string, unknown>).id === entry.groupBy) as Record<string, unknown> | undefined;
        if (!field || !VALUE_TYPES.includes(type) || typeof entry.method !== "string" || !SUMMARY_METHODS[type].includes(entry.method as SummaryMethod) || (entry.groupBy !== undefined && (!group || !["select", "multiselect", "reference", "text"].includes(String(group.type))))) {
          diagnostics.push({ file: record.relativePath, path: `/spec/summary/${index}`, severity: "warning", code: "TICKET_SUMMARY_UNSUPPORTED", message: { ja: `集計の項目または方式を確認してください: ${String(entry.field ?? "")}`, en: `Check the summary field and method: ${String(entry.field ?? "")}` } });
        }
      });
    }
    if (record.spec.defaultSort !== undefined) {
      const raw = record.spec.defaultSort;
      const parsedFields = fields.flatMap((entry) =>
        typeof entry === "object" && entry !== null ? [parseFieldDefinition(entry as Record<string, unknown>)] : []
      ).filter((field): field is FieldDefinition => field !== undefined);
      const resolved = typeof raw === "object" && raw !== null && !Array.isArray(raw)
        ? resolveDefaultSort(raw as Record<string, unknown>, parsedFields)
        : undefined;
      if (!resolved) {
        diagnostics.push({ file: record.relativePath, path: "/spec/defaultSort", severity: "warning",
          code: "TICKET_DEFAULT_SORT_INVALID", message: {
            ja: "既定の並べ替えには、sortを有効にした定義済みの項目とascまたはdescを指定してください",
            en: "The default sort must name a defined field with sorting enabled, with asc or desc."
          } });
      }
    }
    const hierarchy = record.spec.hierarchy;
    if (typeof hierarchy === "object" && hierarchy !== null && !Array.isArray(hierarchy)) {
      const parentField = (hierarchy as Record<string, unknown>).parentField;
      // 親は単一の参照でなければならない。multiple: trueの項目は親にできない
      if (parentField !== undefined && parentField !== null && parentField !== "" && !fields.some((entry) =>
        typeof entry === "object" && entry !== null &&
        (entry as Record<string, unknown>).id === parentField &&
        (entry as Record<string, unknown>).type === "reference" &&
        (entry as Record<string, unknown>).multiple !== true
      )) {
        diagnostics.push({ file: record.relativePath, path: "/spec/hierarchy/parentField",
          severity: "warning", code: "TICKET_PARENT_FIELD_INVALID",
          message: {
            ja: "親項目には定義済みの参照項目を指定してください",
            en: "The parent field must reference a defined field."
          } });
      }
    }
    fields.forEach((entry, index) => {
      if (typeof entry !== "object" || entry === null) return;
      const item = entry as Record<string, unknown>;
      const id = asString(item.id);
      // multipleはreference専用の修飾。他の型やtrue以外の値はfalseで動くが、警告する
      if (item.multiple !== undefined && (item.type !== "reference" || item.multiple !== true)) {
        diagnostics.push({
          file: record.relativePath,
          path: `/spec/fields/${index}/multiple`,
          severity: "warning",
          code: "TICKET_FIELD_MULTIPLE_UNSUPPORTED",
          message: {
            ja: `複数値にできるのは参照項目だけです${id ? `: ${id}` : ""}`,
            en: `Only reference fields can hold multiple values${id ? `: ${id}` : ""}`
          }
        });
      }
      if (item.type !== "select" && item.type !== "multiselect") return;
      const validOptions = asArray(item.options).filter((option) => {
        if (typeof option !== "object" || option === null) return false;
        return asString((option as Record<string, unknown>).value) !== undefined;
      });
      if (validOptions.length > 0) return;
      diagnostics.push({
        file: record.relativePath,
        path: `/spec/fields/${index}/options`,
        severity: "warning",
        code: "TICKET_FIELD_OPTIONS_MISSING",
        message: {
          ja: `選択式の項目に選択肢がありません${id ? `: ${id}` : ""}`,
          en: `Select fields must have options${id ? `: ${id}` : ""}`
        }
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
    case "reference":
      // 複数値の参照は、空の配列から始める
      return field.multiple ? [] : undefined;
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
