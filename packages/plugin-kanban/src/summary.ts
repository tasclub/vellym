import { resolveLocalizedText, type PluginIndexRow, type PluginIndexValue } from "@vellym/plugin-api";
import type { FieldDefinition } from "@vellym-internal/ticket-engine";
import { fieldKey } from "@vellym-internal/ticket-engine";

export type SummaryMethod = "sum" | "average" | "max" | "min" | "count" |
  "earliest" | "latest" | "true" | "false" | "breakdown";

export interface KanbanSummaryDefinition {
  field: FieldDefinition;
  method: SummaryMethod;
}

export const SUMMARY_METHODS: Record<FieldDefinition["type"], readonly SummaryMethod[]> = {
  number: ["sum", "average", "max", "min", "count"],
  date: ["earliest", "latest", "count"],
  boolean: ["true", "false"],
  text: ["count", "breakdown"],
  multiline: ["count", "breakdown"],
  select: ["count", "breakdown"],
  multiselect: ["count", "breakdown"],
  reference: ["count", "breakdown"]
};

function valid(field: FieldDefinition, value: PluginIndexValue): boolean {
  switch (field.type) {
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "date": return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "multiselect": return Array.isArray(value) && value.every((entry) => typeof entry === "string");
    default: return typeof value === "string";
  }
}

export interface SummaryResult {
  text: string;
  /** Incorrect non-empty values skipped from the calculation. */
  excluded: number;
}

/** Calculate from all projected rows; the 20-card rendering limit is unrelated. */
export function summarizeColumn(
  rows: readonly PluginIndexRow[],
  definition: KanbanSummaryDefinition,
  locale: string
): SummaryResult {
  const { field, method } = definition;
  const values: PluginIndexValue[] = [];
  let excluded = 0;
  for (const row of rows) {
    const value = row.values[fieldKey(field.id)];
    if (value === null || value === undefined || value === "") continue;
    if (valid(field, value)) values.push(value);
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
        const name = field.options?.find((option) => option.value === raw)?.label ?? raw;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    text = `${label("内訳", "Breakdown")}: ${[...counts].sort(([a], [b]) => a.localeCompare(b, locale))
      .map(([key, count]) => `${key} ${count}`).join("、") || "—"}`;
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
  return { text: `${field.label} ${text}`, excluded };
}
