import type { KanbanColumn } from "./model.js";
import type { KanbanSort } from "./order.js";

export interface TrackerColumnSettings {
  /** IDs selected for display. Absent tracker entries show every column. */
  columns: string[];
  /** Remember which columns existed so newly defined statuses default to visible. */
  knownColumns: string[];
  sort?: KanbanSort;
}

export type KanbanColumnSettings = Record<string, TrackerColumnSettings>;

export function columnKey(column: Pick<KanbanColumn, "kind" | "id">): string {
  return `${column.kind}:${column.id}`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Old global `hidden` / `collapsed` settings are deliberately not inherited by every tracker. */
export function readColumnSettings(value: unknown): KanbanColumnSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const settings: KanbanColumnSettings = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (!Array.isArray(entry.columns)) continue;
    settings[name] = {
      columns: stringList(entry.columns),
      knownColumns: stringList(entry.knownColumns),
      ...(typeof entry.sort === "object" && entry.sort !== null &&
        typeof (entry.sort as KanbanSort).field === "string" &&
        ["asc", "desc"].includes((entry.sort as KanbanSort).direction)
        ? { sort: entry.sort as KanbanSort } : {})
    };
  }
  return settings;
}

/** Keep a hidden unset/unknown column selectable even after its last ticket moves away. */
export function selectableColumns(
  columns: readonly KanbanColumn[],
  settings: TrackerColumnSettings | undefined
): KanbanColumn[] {
  const present = new Set(columns.map(columnKey));
  const absentSpecial = (settings?.knownColumns ?? [])
    .filter((id) => !present.has(id) && (id === "unset:" || id.startsWith("unknown:")))
    .map((id): KanbanColumn => id === "unset:"
      ? { id: "", kind: "unset", label: { ja: "未設定", en: "Unset" }, rows: [] }
      : {
          id: id.slice("unknown:".length),
          kind: "unknown",
          label: { ja: `定義外: ${id.slice("unknown:".length)}`, en: `Unknown: ${id.slice("unknown:".length)}` },
          rows: []
        });
  return [...columns, ...absentSpecial];
}

export function selectedColumnKeys(
  options: readonly KanbanColumn[],
  settings: TrackerColumnSettings | undefined
): Set<string> {
  if (!settings) return new Set(options.map(columnKey));
  const known = new Set(settings.knownColumns);
  const selected = new Set(settings.columns);
  // A new status should be visible even if a previous selection was saved.
  for (const column of options) {
    const key = columnKey(column);
    if (!known.has(key)) selected.add(key);
  }
  return selected;
}

export function toggleColumn(
  options: readonly KanbanColumn[],
  settings: TrackerColumnSettings | undefined,
  key: string
): TrackerColumnSettings {
  const selected = selectedColumnKeys(options, settings);
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  return {
    columns: [...selected],
    knownColumns: [...new Set([...(settings?.knownColumns ?? []), ...options.map(columnKey)])],
    ...(settings?.sort ? { sort: settings.sort } : {})
  };
}
