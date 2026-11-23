import type { PluginIndexRow, PluginLocalizedText } from "@vellym/plugin-api";
import { STATUS_KEY, STATUS_UNSET } from "@vellym-internal/ticket-engine";
import type { KanbanRendererData, KanbanStatusDefinition } from "./board.js";

export interface KanbanColumn {
  id: string;
  label: PluginLocalizedText;
  kind: "defined" | "unset" | "unknown";
  rows: readonly PluginIndexRow[];
}

/** 定義順を保ち、未設定・定義外の値も落とさず列へ束ねる。 */
export function buildKanbanColumns(
  data: KanbanRendererData,
  rows: readonly PluginIndexRow[],
  locale: string
): KanbanColumn[] {
  const known = new Map<string, KanbanStatusDefinition>(
    data.statuses.map((status) => [status.id, status])
  );
  const grouped = new Map<string, PluginIndexRow[]>();
  for (const row of rows) {
    const raw = row.values[STATUS_KEY];
    const value = raw === undefined || raw === null ? STATUS_UNSET : String(raw);
    const list = grouped.get(value) ?? [];
    list.push(row);
    grouped.set(value, list);
  }

  const columns: KanbanColumn[] = data.statuses.map((status) => ({
    id: status.id,
    label: status.label,
    kind: "defined",
    rows: grouped.get(status.id) ?? []
  }));
  if (grouped.has(STATUS_UNSET)) {
    columns.push({
      id: STATUS_UNSET,
      label: { ja: "未設定", en: "Unset" },
      kind: "unset",
      rows: grouped.get(STATUS_UNSET) ?? []
    });
  }
  const unknown = [...grouped.keys()]
    .filter((value) => value !== STATUS_UNSET && !known.has(value))
    .sort((left, right) => left.localeCompare(right, locale));
  for (const value of unknown) {
    columns.push({
      id: value,
      label: { ja: `定義外: ${value}`, en: `Unknown: ${value}` },
      kind: "unknown",
      rows: grouped.get(value) ?? []
    });
  }
  return columns;
}
