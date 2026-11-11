import { summarizeRows, SUMMARY_METHODS, type SummaryMethod, type SummaryResult, type PluginIndexRow } from "@vellym/plugin-api";
import { fieldKey, type FieldDefinition } from "@vellym-internal/ticket-engine";
export { SUMMARY_METHODS, type SummaryMethod, type SummaryResult };
export interface KanbanSummaryDefinition { field: FieldDefinition; method: SummaryMethod }
export function summarizeColumn(rows: readonly PluginIndexRow[], { field, method }: KanbanSummaryDefinition, locale: string): SummaryResult {
  const key = fieldKey(field.id);
  // Preserve Kanban's option-label breakdown without changing stored values.
  const mapped = method === "breakdown" && field.options ? rows.map((row) => {
    const label = (value: string) => field.options?.find((option) => option.value === value)?.label ?? value;
    const value = row.values[key];
    return { ...row, values: { ...row.values, [key]: Array.isArray(value) ? value.map(label) : typeof value === "string" ? label(value) : value ?? null } };
  }) : rows;
  const result = summarizeRows(mapped, key, field.type, method, locale);
  return { ...result, text: `${field.label} ${result.text}` };
}
