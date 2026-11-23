import type { PluginDiagnostic, PluginIndexRow } from "@vellym/plugin-api";
import { fieldKey } from "./projection.js";
import type { Tracker } from "./definitions.js";

export interface TicketTreeNode {
  row: PluginIndexRow;
  children: TicketTreeNode[];
}

export interface TicketHierarchy {
  roots: TicketTreeNode[];
  diagnostics: PluginDiagnostic[];
}

/** Break only invalid parent edges; keep every Ticket visible. No depth limit or recursion. */
export function buildTicketHierarchy(tracker: Tracker, rows: readonly PluginIndexRow[]): TicketHierarchy {
  const diagnostics: PluginDiagnostic[] = [];
  const nodes = new Map(rows.map((row) => [row.name, { row, children: [] } as TicketTreeNode]));
  const parents = new Map<string, string>();
  if (tracker.parentField) {
    for (const row of rows) {
      const value = row.values[fieldKey(tracker.parentField)];
      if (typeof value !== "string" || !value) continue;
      if (!nodes.has(value)) {
        diagnostics.push({ file: row.name, path: `/spec/fields/${tracker.parentField}`,
          severity: "warning", code: "TICKET_PARENT_UNRESOLVED",
          message: {
            ja: `親チケットが見つかりません: ${value}`,
            en: `Parent ticket not found: ${value}`
          } });
      } else parents.set(row.name, value);
    }
  }

  const checked = new Set<string>();
  for (const name of nodes.keys()) {
    if (checked.has(name)) continue;
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let cursor: string | undefined = name;
    while (cursor && !checked.has(cursor)) {
      const cycleStart = positions.get(cursor);
      if (cycleStart !== undefined) {
        for (const member of chain.slice(cycleStart)) {
          parents.delete(member);
          diagnostics.push({ file: member, path: `/spec/fields/${tracker.parentField}`,
            severity: "warning", code: "TICKET_PARENT_CYCLE",
            message: {
              ja: "親子参照が循環しています",
              en: "The parent relationship contains a cycle."
            } });
        }
        break;
      }
      positions.set(cursor, chain.length);
      chain.push(cursor);
      cursor = parents.get(cursor);
    }
    for (const visited of chain) checked.add(visited);
  }

  const roots: TicketTreeNode[] = [];
  for (const [name, node] of nodes) {
    const parent = nodes.get(parents.get(name) ?? "");
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return { roots, diagnostics };
}
