import type { PluginIndexRow } from "@vellym/plugin-api";
import type { TicketTreeNode } from "@vellym-internal/ticket-engine";
import { fieldKey } from "@vellym-internal/ticket-engine";

/** Follow the original graph, including edges the display hierarchy has cut. */
export function excludedParents(rows: readonly PluginIndexRow[], name: string, field: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const parent = row.values[fieldKey(field)];
    if (typeof parent === "string") children.set(parent, [...(children.get(parent) ?? []), row.name]);
  }
  const excluded = new Set<string>();
  const pending = [name];
  while (pending.length) {
    const current = pending.pop()!;
    if (excluded.has(current)) continue;
    excluded.add(current);
    pending.push(...(children.get(current) ?? []));
  }
  return excluded;
}

/** Missing ranks sort last: do not pretend a numeric rank can append after them. */
export function rankForAppend(rows: readonly PluginIndexRow[], field: string): number | undefined {
  let maximum: number | undefined;
  for (const row of rows) {
    const rank = row.values[fieldKey(field)];
    if (typeof rank !== "number" || !Number.isFinite(rank)) return undefined;
    maximum = maximum === undefined ? rank : Math.max(maximum, rank);
  }
  if (maximum === undefined) return 1;
  const next = maximum + Math.max(1, Math.abs(maximum) * Number.EPSILON);
  return Number.isFinite(next) && next > maximum ? next : undefined;
}

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

export interface WBSRow {
  node: TicketTreeNode;
  depth: number;
  siblings: readonly PluginIndexRow[];
  index: number;
}

/** A single preorder sequence shared by every rendering strategy. */
export function flattenRows(nodes: readonly TicketTreeNode[], field: string | undefined, locale: string,
  collapsed: ReadonlySet<string>): WBSRow[] {
  const result: WBSRow[] = [];
  const stack: WBSRow[] = [];
  const push = (children: readonly TicketTreeNode[], depth: number) => {
    const sorted = sortedSiblings(children, field, locale);
    const siblings = sorted.map((node) => node.row);
    for (let index = sorted.length - 1; index >= 0; index--) {
      stack.push({ node: sorted[index]!, depth, siblings, index });
    }
  };
  push(nodes, 0);
  while (stack.length) {
    const item = stack.pop()!;
    result.push(item);
    if (!collapsed.has(item.node.row.name)) push(item.node.children, item.depth + 1);
  }
  return result;
}

export type RowRendering = "all" | "virtual" | "incremental";
export const DEFAULT_ROW_RENDERING: RowRendering = "all";
export function rowWindow(total: number, strategy: RowRendering, scrollTop: number,
  viewportHeight: number, rowHeight: number, loaded: number): { start: number; end: number } {
  if (strategy === "all") return { start: 0, end: total };
  if (strategy === "incremental") return { start: 0, end: Math.min(total, loaded) };
  const first = Math.min(total, Math.max(0, Math.floor(scrollTop / rowHeight)));
  return { start: Math.max(0, first - 10),
    end: Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 10) };
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
  if (before && left === undefined) return undefined;
  if (left === undefined) {
    const result = right! - Math.max(1, Math.abs(right!) * Number.EPSILON);
    return Number.isFinite(result) && result < right! ? result : undefined;
  }
  if (right === undefined) {
    const result = left + Math.max(1, Math.abs(left) * Number.EPSILON);
    return Number.isFinite(result) && result > left ? result : undefined;
  }
  const result = left + (right - left) / 2;
  return result > left && result < right ? result : undefined;
}
