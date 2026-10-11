import type { PluginIndexRow } from "@vellym/plugin-api";
import type { TicketTreeNode } from "@vellym-internal/ticket-engine";
import { fieldKey } from "@vellym-internal/ticket-engine";

export function sortedSiblings(nodes: readonly TicketTreeNode[], field: string | undefined, locale: string): TicketTreeNode[] {
  return [...nodes].sort((a, b) => {
    const left = field ? a.row.values[fieldKey(field)] : undefined;
    const right = field ? b.row.values[fieldKey(field)] : undefined;
    const l = typeof left === "number" && Number.isFinite(left) ? left : undefined;
    const r = typeof right === "number" && Number.isFinite(right) ? right : undefined;
    if ((l === undefined) !== (r === undefined)) return l === undefined ? 1 : -1;
    return (l !== undefined && r !== undefined ? l - r : 0) ||
      a.row.title.localeCompare(b.row.title, locale) || a.row.name.localeCompare(b.row.name);
  });
}

/** Update one Ticket only; return undefined if the desired position requires explicit renumbering. */
export function rankForMove(rows: readonly PluginIndexRow[], index: number, delta: -1 | 1, field: string): number | undefined {
  return rankForInsert(rows, index, index + delta, field);
}

/** The target is the insertion index after removing the source. */
export function rankForInsert(rows: readonly PluginIndexRow[], index: number, target: number, field: string): number | undefined {
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return undefined;
  const remaining = rows.filter((_, spot) => spot !== index);
  const rank = (row: PluginIndexRow | undefined) => {
    const value = row?.values[fieldKey(field)];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const before = remaining[target - 1];
  const left = rank(before);
  const right = rank(remaining[target]);
  if (left === undefined && right === undefined) {
    if (before) return undefined;
    const ranks = remaining.map(rank).filter((value): value is number => value !== undefined);
    return ranks.length ? Math.max(...ranks) + 1 : 0;
  }
  if (left === undefined) return right! - 1;
  if (right === undefined) return left + 1;
  const result = left + (right - left) / 2;
  return result > left && result < right ? result : undefined;
}
