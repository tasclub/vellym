import { summarizeRows, SUMMARY_METHODS, type SummaryMethod, type SummaryResult, type PluginIndexRow } from "@vellym/plugin-api";
import { fieldKey, type FieldDefinition } from "@vellym-internal/ticket-engine";
export { SUMMARY_METHODS, type SummaryMethod, type SummaryResult };
export interface KanbanSummaryDefinition { field: FieldDefinition; method: SummaryMethod; groupBy?: FieldDefinition }
export function summarizeColumn(rows: readonly PluginIndexRow[], { field, method, groupBy }: KanbanSummaryDefinition, locale: string, allRows = rows): SummaryResult {
  const key = fieldKey(field.id);
  const groupKey = groupBy && fieldKey(groupBy.id) === key && method === "breakdown" && field.options ? `${key}:group-original` : groupBy ? fieldKey(groupBy.id) : undefined;
  // Preserve Kanban's option-label breakdown without changing stored values.
  const mapped = method === "breakdown" && field.options ? rows.map((row) => {
    const label = (value: string) => field.options?.find((option) => option.value === value)?.label ?? value;
    const value = row.values[key];
    return { ...row, values: { ...row.values, ...(groupKey && groupKey !== key && groupBy?.id === field.id ? { [groupKey]: value ?? null } : {}), [key]: Array.isArray(value) ? value.map(label) : typeof value === "string" ? label(value) : value ?? null } };
  }) : rows;
  const result = summarizeRows(mapped, key, field.type, method, locale, groupBy ? { groupBy: {
    key: groupKey!, type: groupBy.type, order: groupBy.type === "select" ? groupBy.options?.map((option) => option.value) : undefined,
    labelOf: groupBy.type === "reference" ? (value) => allRows.find((row) => row.name === value)?.title ?? value : undefined
  } } : undefined);
  return { ...result, text: `${field.label} ${result.text}` };
}
