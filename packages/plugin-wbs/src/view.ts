import type { PluginDiagnostic, PluginListViewDescriptor, PluginViewContext } from "@vellym/plugin-api";
import { TRACKERS_KEY, readTrackers, type Tracker } from "@vellym-internal/ticket-engine";

export const WBS_VIEW_ID = "wbs-tree";

export interface WBSRendererData extends Readonly<Record<string, unknown>> {
  tracker?: Tracker;
  parentField?: string;
  startField?: string;
  endField?: string;
  orderField?: string;
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
  const data: WBSRendererData = {
    ...(tracker ? { tracker } : {}),
    ...(parentField ? { parentField } : {}),
    ...(startField ? { startField } : {}),
    ...(endField ? { endField } : {}),
    ...(orderField ? { orderField } : {}),
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
