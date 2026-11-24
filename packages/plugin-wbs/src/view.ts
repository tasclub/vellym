import type { PluginDiagnostic, PluginListViewDescriptor, PluginViewContext } from "@vellym/plugin-api";
import { TRACKERS_KEY, readTrackers, type Tracker } from "@vellym-internal/ticket-engine";

export const WBS_VIEW_ID = "wbs-tree";

export type WBSColumn = { id: string; label: string; type: string; options?: { value: string; label: string }[] };

export function formatCell(column: WBSColumn, value: unknown, rows: readonly { name: string; title: string }[], data: WBSRendererData): string {
  if (value === undefined || value === null || value === "" || Array.isArray(value) && !value.length) return "—";
  if (column.type === "boolean") return value === true ? "✓" : "";
  if (column.id === "status") {
    const status = data.tracker?.statuses.find((item) => item.id === value);
    return `${data.statusSymbols?.[String(value)] || (status?.category === "closed" ? "✓" : "□")} ${status?.label ?? String(value)}`;
  }
  const render = (item: unknown) => column.type === "reference"
    ? rows.find((row) => row.name === item)?.title ?? String(item)
    : column.options?.find((option) => option.value === item)?.label ?? String(item);
  return Array.isArray(value) ? value.map(render).join("、") : render(value);
}

export interface WBSRendererData extends Readonly<Record<string, unknown>> {
  tracker?: Tracker;
  parentField?: string;
  startField?: string;
  endField?: string;
  orderField?: string;
  statusSymbols?: Readonly<Record<string, string>>;
  columns: readonly WBSColumn[];
  diagnostics: readonly PluginDiagnostic[];
}

export function wbsView(context: PluginViewContext): PluginListViewDescriptor {
  const tracker = context.target?.kind === "TicketTracker"
    ? readTrackers(context).find((item) => item.name === context.target?.name) : undefined;
  const config = context.target?.spec.wbs;
  const wbs = typeof config === "object" && config !== null && !Array.isArray(config)
    ? config as Record<string, unknown> : {};
  const diagnostics: PluginDiagnostic[] = [];
  const field = (setting: "parentField" | "startField" | "endField" | "orderField", type: "reference" | "date" | "number", fallback?: string) => {
    const id = Object.hasOwn(wbs, setting) ? wbs[setting] : fallback;
    if (id === undefined || id === null || id === "") return undefined;
    const found = tracker?.fields.find((item) => item.id === id && item.type === type);
    if (found) return found.id;
    diagnostics.push({ file: context.target?.relativePath ?? ".", path: `/spec/wbs/${setting}`,
      severity: "warning", code: "WBS_FIELD_INVALID",
      message: {
        ja: `${setting}には定義済みの${type}項目を指定してください: ${String(id)}`,
        en: `Choose a defined ${type} field for ${setting}: ${String(id)}`
      } });
    return undefined;
  };
  const parentField = field("parentField", "reference", tracker?.parentField);
  const startField = field("startField", "date");
  const endField = field("endField", "date");
  const orderField = field("orderField", "number");
  const candidates: WBSColumn[] = [{ id: "status", label: context.locale.startsWith("ja") ? "状態" : "Status", type: "status" },
    ...(tracker?.fields.filter((item) => item.type !== "multiline" && item.id !== parentField && item.id !== orderField) ?? [])];
  const selected = Object.hasOwn(wbs, "columns") && Array.isArray(wbs.columns)
    ? wbs.columns : ["status", startField, endField].filter((id): id is string => !!id);
  const columns = selected.flatMap((id, index) => {
    const found = candidates.find((item) => item.id === id);
    if (found) return [found];
    diagnostics.push({ file: context.target?.relativePath ?? ".", path: `/spec/wbs/columns/${index}`,
      severity: "warning", code: "WBS_FIELD_INVALID", message: {
        ja: `詳細の列に指定できない項目です: ${String(id)}`,
        en: `Invalid details column: ${String(id)}`
      } });
    return [];
  });
  const data: WBSRendererData = {
    columns,
    ...(tracker ? { tracker } : {}),
    ...(parentField ? { parentField } : {}),
    ...(startField ? { startField } : {}),
    ...(endField ? { endField } : {}),
    ...(orderField ? { orderField } : {}),
    statusSymbols: Object.fromEntries((Array.isArray(context.target?.spec.statuses) ? context.target.spec.statuses : [])
      .filter((value): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value))
      .filter((value) => typeof value.id === "string" && typeof value.symbol === "string" && value.symbol.trim())
      .map((value) => [value.id as string, value.symbol as string])),
    diagnostics
  };
  return {
    type: "list", id: WBS_VIEW_ID, kind: "Ticket", paperWidth: "full",
    title: tracker?.title ?? { ja: "WBS", en: "WBS" },
    columns: [],
    scopeFilters: [{ columnId: TRACKERS_KEY, operator: "contains", value: tracker?.name ?? "" }],
    rendererData: data
  };
}
