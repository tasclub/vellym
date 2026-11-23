import { summarizeRows, SUMMARY_METHODS, type SummaryMethod, type SummaryResult, type PluginIndexRow } from "@vellym/plugin-api";
import { fieldKey, type FieldDefinition } from "@vellym-internal/ticket-engine";
export { SUMMARY_METHODS, type SummaryMethod, type SummaryResult };
export interface KanbanSummaryDefinition { field: FieldDefinition; method: SummaryMethod; groupBy?: FieldDefinition }
/** The same calculation and names as the list and WBS: choice labels come from the definition. */
export function summarizeColumn(rows: readonly PluginIndexRow[], { field, method, groupBy }: KanbanSummaryDefinition, locale: string, allRows = rows): SummaryResult {
  const result = summarizeRows(rows, fieldKey(field.id), field.type, method, locale, {
    ...(field.options ? { valueLabels: field.options } : {}),
    ...(groupBy ? { groupBy: {
      key: fieldKey(groupBy.id), type: groupBy.type, order: groupBy.type === "select" ? groupBy.options?.map((option) => option.value) : undefined,
      labels: groupBy.options,
      labelOf: groupBy.type === "reference" ? (value: string) => allRows.find((row) => row.name === value)?.title ?? value : undefined
    } } : {})
  });
  return { ...result, text: `${field.label} ${result.text}` };
}
