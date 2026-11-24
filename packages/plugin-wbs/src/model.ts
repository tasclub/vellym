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

function compareRows(a: PluginIndexRow, b: PluginIndexRow, field: string | undefined, locale: string): number {
  const left = field ? a.values[fieldKey(field)] : undefined;
  const right = field ? b.values[fieldKey(field)] : undefined;
  const l = typeof left === "number" && Number.isFinite(left) ? left : undefined;
  const r = typeof right === "number" && Number.isFinite(right) ? right : undefined;
  if ((l === undefined) !== (r === undefined)) return l === undefined ? 1 : -1;
  return (l !== undefined && r !== undefined ? l - r : 0) ||
    a.title.localeCompare(b.title, locale) || a.name.localeCompare(b.name);
}

export function sortedSiblings(nodes: readonly TicketTreeNode[], field: string | undefined, locale: string): TicketTreeNode[] {
  return [...nodes].sort((a, b) => compareRows(a.row, b.row, field, locale));
}

export interface ParentMoveTarget {
  /** Empty string denotes a top-level row. */
  parent: string;
  /** Present when the Tracker declares an order field; undefined means the position needs renumbering. */
  order?: number;
}

function parentName(row: PluginIndexRow, field: string): string {
  const parent = row.values[fieldKey(field)];
  return typeof parent === "string" ? parent : "";
}

function hasInvalidAncestry(rows: readonly PluginIndexRow[], name: string, parentField: string): boolean {
  const byName = new Map(rows.map((row) => [row.name, row]));
  let current = byName.get(name);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.name)) return true;
    seen.add(current.name);
    const parent = parentName(current, parentField);
    if (!parent) return false;
    current = byName.get(parent);
    if (!current) return true;
  }
  return true;
}

function orderedRows(rows: readonly PluginIndexRow[], orderField: string | undefined, locale: string): PluginIndexRow[] {
  return [...rows].sort((a, b) => compareRows(a, b, orderField, locale));
}

/** Move a row under its immediately preceding sibling, appending it to that sibling's children. */
export function indentTarget(rows: readonly PluginIndexRow[], name: string, parentField: string,
  orderField?: string, locale = "ja"): ParentMoveTarget | undefined {
  const row = rows.find((item) => item.name === name);
  if (!row || hasInvalidAncestry(rows, name, parentField)) return undefined;
  const parent = parentName(row, parentField);
  const siblings = orderedRows(rows.filter((item) => parentName(item, parentField) === parent), orderField, locale);
  const index = siblings.findIndex((item) => item.name === name);
  if (index <= 0) return undefined;
  const nextParent = siblings[index - 1]!.name;
  const children = rows.filter((item) => item.name !== name && parentName(item, parentField) === nextParent);
  return orderField
    ? { parent: nextParent, order: rankForAppend(children, orderField) }
    : { parent: nextParent };
}

/** Move a row to its grandparent's children immediately after its current parent. */
export function outdentTarget(rows: readonly PluginIndexRow[], name: string, parentField: string,
  orderField?: string, locale = "ja"): ParentMoveTarget | undefined {
  const row = rows.find((item) => item.name === name);
  if (!row || hasInvalidAncestry(rows, name, parentField)) return undefined;
  const parentNameValue = parentName(row, parentField);
  if (!parentNameValue) return undefined;
  const byName = new Map(rows.map((item) => [item.name, item]));
  const parent = byName.get(parentNameValue);
  if (!parent) return undefined;
  const nextParent = parentName(parent, parentField);
  const siblings = orderedRows(rows.filter((item) => item.name !== name &&
    parentName(item, parentField) === nextParent), orderField, locale);
  const parentIndex = siblings.findIndex((item) => item.name === parent.name);
  if (parentIndex < 0) return undefined;
  if (!orderField) return { parent: nextParent };
  // Treat the moving row as a virtual item at the end, then calculate its rank at the position after parent.
  const rankRows = [...siblings, row];
  return { parent: nextParent, order: rankForInsert(rankRows, siblings.length, parentIndex + 1, orderField) };
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
