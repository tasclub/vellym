import type { PluginIndexRow } from "@vellym/plugin-api";

export interface KanbanSort {
  field: string;
  direction: "asc" | "desc";
}

/** Stable, deterministic sorting even for missing values and duplicate ranks. */
export function sortKanbanRows(
  rows: readonly PluginIndexRow[],
  sort: KanbanSort,
  locale: string
): PluginIndexRow[] {
  const compare = (a: PluginIndexRow, b: PluginIndexRow) => {
    const left = sort.field === "title" ? a.title : a.values[sort.field];
    const right = sort.field === "title" ? b.title : b.values[sort.field];
    const empty = (value: unknown) => value === null || value === undefined || value === "";
    if (empty(left) !== empty(right)) return empty(left) ? 1 : -1;
    if (!empty(left) && !empty(right)) {
      const result = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), locale, { numeric: true });
      if (result) return sort.direction === "desc" ? -result : result;
    }
    return a.name.localeCompare(b.name);
  };
  return [...rows].sort(compare);
}

export const DEFAULT_SORT: KanbanSort = { field: "title", direction: "asc" };

/** Return a rank that moves one row by one slot, without rewriting other Tickets. */
export function neighboringRank(
  sorted: readonly PluginIndexRow[],
  index: number,
  delta: -1 | 1,
  field: string
): number | undefined {
  const target = index + delta;
  if (target < 0 || target >= sorted.length) return undefined;
  const remaining = sorted.filter((_, position) => position !== index);
  const before = remaining[target - 1];
  const after = remaining[target];
  const rank = (row: PluginIndexRow | undefined): number | undefined => {
    const value = row?.values[field];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const left = rank(before);
  const right = rank(after);
  if (left === undefined && right === undefined) {
    // Undefined ranks sort after every numeric rank. A one-record move among
    // multiple undefined ranks is not representable; explicit renumbering fixes it.
    if (before) return undefined;
    const ranks = remaining.map(rank).filter((value): value is number => value !== undefined);
    return ranks.length ? Math.max(...ranks) + 1 : 0;
  }
  if (left === undefined) return right! - 1;
  if (right === undefined) return left + 1;
  const midpoint = left + (right - left) / 2;
  return midpoint > left && midpoint < right ? midpoint : undefined;
}
