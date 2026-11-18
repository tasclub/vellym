import { resolveLocalizedText } from "./text.js";
import type { PluginIndexRow } from "./host.js";
import type { PluginIndexValue } from "./records.js";
import type { PluginValueType } from "./views.js";

export type SummaryMethod = "sum" | "average" | "max" | "min" | "count" | "earliest" | "latest" | "true" | "false" | "breakdown";

export const SUMMARY_METHODS: Record<PluginValueType, readonly SummaryMethod[]> = {
  number: ["sum", "average", "max", "min", "count"],
  date: ["earliest", "latest", "count"],
  boolean: ["true", "false"],
  text: ["count", "breakdown"],
  multiline: ["count", "breakdown"],
  select: ["count", "breakdown"],
  multiselect: ["count", "breakdown"],
  reference: ["count", "breakdown"]
};

function valid(type: PluginValueType, value: PluginIndexValue): boolean {
  switch (type) {
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "date": return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "multiselect": return Array.isArray(value) && value.every((entry) => typeof entry === "string");
    // 参照は単一なら文字列、`multiple: true`なら文字列の配列。集計はどちらも数える。
    // 型の一致自体は`ticket-engine`のprojectionがすでに警告している。
    case "reference":
      return typeof value === "string" || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
    default: return typeof value === "string";
  }
}

export interface SummaryResult {
  text: string;
  /** Incorrect non-empty values skipped from the calculation. */
  excluded: number;
  groups?: { value: string | null; label: string; text: string; excluded: number }[];
  multiCounted?: boolean;
}

/** A choice value and the name to show for it. */
export interface SummaryValueLabel { value: string; label: string }

/** Calculate from all projected rows; the 20-card rendering limit is unrelated. */
export function summarizeRows(
  rows: readonly PluginIndexRow[],
  key: string,
  type: PluginValueType,
  method: SummaryMethod,
  locale: string,
  options?: {
    /** Choice values with their display names, in definition order: the breakdown uses these. */
    valueLabels?: readonly SummaryValueLabel[];
    groupBy?: { key: string; type: PluginValueType; order?: readonly string[]; labels?: readonly SummaryValueLabel[]; labelOf?: (value: string) => string };
  }
): SummaryResult {
  if (options?.groupBy) {
    const groupBy = options.groupBy;
    const buckets = new Map<string | null, PluginIndexRow[]>();
    for (const row of rows) {
      const raw = row.values[groupBy.key];
      // `multiselect`と同じく、配列の値は値ごとに分ける（`multiple: true`の参照を含む）。
      const entries = (groupBy.type === "multiselect" || groupBy.type === "reference") && Array.isArray(raw)
        ? [...new Set(raw.filter((value): value is string => typeof value === "string" && value !== ""))]
        : typeof raw === "string" && raw !== "" ? [raw] : [];
      for (const value of entries.length ? entries : [null]) {
        const bucket = buckets.get(value) ?? [];
        bucket.push(row);
        buckets.set(value, bucket);
      }
    }
    const groups = [...buckets].sort(([a], [b]) => {
      if (a === null) return b === null ? 0 : 1;
      if (b === null) return -1;
      const order = groupBy.order ?? groupBy.labels?.map((item) => item.value);
      const ai = order?.indexOf(a) ?? -1, bi = order?.indexOf(b) ?? -1;
      if (ai !== bi && (ai >= 0 || bi >= 0)) return ai < 0 ? 1 : bi < 0 ? -1 : ai - bi;
      return a.localeCompare(b, locale);
    }).map(([value, bucket]) => ({ value, label: value === null
      ? resolveLocalizedText({ ja: "（未設定）", en: "(Not set)" }, locale)
      : groupBy.labels?.find((item) => item.value === value)?.label ?? groupBy.labelOf?.(value) ?? value,
      ...summarizeRows(bucket, key, type, method, locale, { valueLabels: options.valueLabels }) }));
    return { ...summarizeRows(rows, key, type, method, locale, { valueLabels: options.valueLabels }), groups, ...((groupBy.type === "multiselect" || groupBy.type === "reference") ? { multiCounted: true } : {}) };
  }
  const values: PluginIndexValue[] = [];
  let excluded = 0;
  for (const row of rows) {
    const value = row.values[key];
    if (value === null || value === undefined || value === "") continue;
    if (valid(type, value)) values.push(value);
    else excluded++;
  }
  const label = (j: string, e: string) => resolveLocalizedText({ ja: j, en: e }, locale);
  let text: string;
  if (method === "count") text = `${label("件数", "Count")}: ${values.length}`;
  else if (method === "true" || method === "false") {
    text = `${label(method === "true" ? "真" : "偽", method === "true" ? "True" : "False")}: ${values.filter((value) => value === (method === "true")).length}`;
  } else if (method === "breakdown") {
    const counts = new Map<string, number>();
    for (const value of values) {
      for (const entry of Array.isArray(value) ? value : [value]) {
        const raw = String(entry);
        counts.set(raw, (counts.get(raw) ?? 0) + 1);
      }
    }
    // Known choices first in definition order, by display name; unknown values after, as written.
    const known = options?.valueLabels ?? [];
    const position = (value: string) => { const index = known.findIndex((item) => item.value === value); return index < 0 ? Infinity : index; };
    text = `${label("内訳", "Breakdown")}: ${[...counts].sort(([a], [b]) => position(a) - position(b) || a.localeCompare(b, locale))
      .map(([value, count]) => `${known.find((item) => item.value === value)?.label ?? value} ${count}`).join("、") || "—"}`;
  } else if (method === "earliest" || method === "latest") {
    const dates = values as string[];
    const date = [...dates].sort()[method === "earliest" ? 0 : dates.length - 1];
    text = `${label(method === "earliest" ? "最早" : "最遅", method === "earliest" ? "Earliest" : "Latest")}: ${date ?? "—"}`;
  } else {
    const numbers = values as number[];
    const sum = numbers.reduce((total, value) => total + value, 0);
    const number = method === "sum" ? sum : method === "average" ? sum / numbers.length
      : method === "max" ? Math.max(...numbers) : Math.min(...numbers);
    const caption = { sum: label("合計", "Sum"), average: label("平均", "Average"),
      max: label("最大", "Max"), min: label("最小", "Min") }[method];
    text = `${caption}: ${numbers.length ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(number) : "—"}`;
  }
  return { text: text, excluded };
}
