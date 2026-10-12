import type { PluginIndexRow } from "@vellym/plugin-api";
import type { FieldDefinition } from "@vellym-internal/ticket-engine";
import { fieldKey } from "@vellym-internal/ticket-engine";

export type KanbanFilterValues = Readonly<Record<string, string>>;

/** Select values match exactly; free-form values match case-insensitively by substring. */
export function matchesKanbanFilters(
  row: PluginIndexRow,
  fields: readonly FieldDefinition[],
  filters: KanbanFilterValues
): boolean {
  return fields.every((field) => {
    const query = filters[field.id] ?? "";
    if (!query) return true;
    const value = row.values[fieldKey(field.id)];
    const values = Array.isArray(value) ? value : [value];
    if (field.type === "select" || field.type === "multiselect" || field.type === "boolean") {
      return values.some((item) => String(item ?? "") === query);
    }
    const needle = query.toLowerCase();
    return values.some((item) => String(item ?? "").toLowerCase().includes(needle));
  });
}

export function filterKanbanRows(
  rows: readonly PluginIndexRow[],
  fields: readonly FieldDefinition[],
  filters: KanbanFilterValues
): PluginIndexRow[] {
  return rows.filter((row) => matchesKanbanFilters(row, fields, filters));
}
