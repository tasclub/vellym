import type {
  PluginDiagnostic,
  PluginListViewDescriptor,
  PluginLocalizedText,
  PluginViewContext
} from "@vellym/plugin-api";
import {
  STATUS_KEY,
  TRACKERS_KEY,
  readTrackers,
  type FieldDefinition,
  type Tracker
} from "@vellym-internal/ticket-engine";
import { SUMMARY_METHODS, type KanbanSummaryDefinition, type SummaryMethod } from "./summary.js";

export const BOARD_VIEW_ID = "ticket-kanban";

export interface KanbanStatusDefinition {
  id: string;
  label: string;
}

export interface KanbanRendererData extends Readonly<Record<string, unknown>> {
  statuses: readonly KanbanStatusDefinition[];
  fields: readonly FieldDefinition[];
  cardFields: readonly FieldDefinition[];
  summaries: readonly KanbanSummaryDefinition[];
  orderField?: FieldDefinition;
  diagnostics: readonly PluginDiagnostic[];
}

function warning(
  context: PluginViewContext,
  path: string,
  code: string,
  message: PluginLocalizedText
): PluginDiagnostic {
  return {
    file: context.target?.relativePath ?? ".",
    path,
    severity: "warning",
    code,
    message
  };
}

/** 開いているTicketTrackerの状態定義を解決する。 */
export function resolveKanbanDefinition(context: PluginViewContext): KanbanRendererData {
  const diagnostics: PluginDiagnostic[] = [];
  const tracker: Tracker | undefined = context.target?.kind === "TicketTracker"
    ? readTrackers(context).find((candidate) => candidate.name === context.target?.name)
    : undefined;
  if (!tracker) {
    diagnostics.push(
      warning(
        context,
        "/",
        "KANBAN_TRACKER_UNRESOLVED",
        { ja: "このチケット管理のステータスの定義を読み込めません", en: "Could not resolve the opened TicketTracker status definitions." }
      )
    );
  }

  const statuses: KanbanStatusDefinition[] = [];
  const seen = new Set<string>();
  for (const status of tracker?.statuses ?? []) {
    if (seen.has(status.id)) {
      diagnostics.push(
        warning(
          context,
          "/spec/statuses",
          "KANBAN_STATUS_DUPLICATED",
          { ja: `TicketTrackerのstatusが重複しています: ${status.id}`, en: `The TicketTracker status is duplicated: ${status.id}` }
        )
      );
      continue;
    }
    seen.add(status.id);
    statuses.push({ id: status.id, label: status.label });
  }

  const rawKanban = context.target?.spec.kanban;
  const kanban = typeof rawKanban === "object" && rawKanban !== null && !Array.isArray(rawKanban)
    ? rawKanban as Record<string, unknown>
    : {};
  const cardFields: FieldDefinition[] = [];
  const summaries: KanbanSummaryDefinition[] = [];
  const requestedOrder = kanban.orderField ?? "order";
  const orderField = tracker?.fields.find((field) => field.id === requestedOrder && field.type === "number");
  if (kanban.orderField !== undefined && !orderField) {
    diagnostics.push(warning(context, "/spec/kanban/orderField", "KANBAN_ORDER_FIELD_INVALID", {
      ja: `並び順には定義済みの数値項目を指定してください: ${String(requestedOrder)}`,
      en: `Choose a defined numeric field for ordering: ${String(requestedOrder)}`
    }));
  }
  if (kanban.card !== undefined && (!Array.isArray(kanban.card) ||
      !kanban.card.every((id: unknown) => typeof id === "string"))) {
    diagnostics.push(warning(context, "/spec/kanban/card", "KANBAN_CARD_INVALID", {
      ja: "カード項目はIDの配列で指定してください", en: "Card fields must be specified as an array of IDs."
    }));
  } else {
    for (const id of (kanban.card ?? []) as string[]) {
      const field = tracker?.fields.find((item) => item.id === id);
      if (!field) {
        diagnostics.push(warning(context, "/spec/kanban/card", "KANBAN_CARD_FIELD_UNDEFINED", {
          ja: `カード項目が定義にありません: ${id}`, en: `The card field is not defined: ${id}`
        }));
      } else if (!cardFields.some((item) => item.id === id)) {
        cardFields.push(field);
      }
    }
  }
  if (kanban.summary === undefined) summaries.push(...(tracker?.summary ?? []));
  if (kanban.summary !== undefined) {
    if (!Array.isArray(kanban.summary)) {
      diagnostics.push(warning(context, "/spec/kanban/summary", "KANBAN_SUMMARY_INVALID", {
        ja: "集計は項目と方式の配列で指定してください", en: "Summaries must be specified as an array of fields and methods."
      }));
    } else {
      kanban.summary.forEach((raw: unknown, index: number) => {
        const entry = typeof raw === "object" && raw !== null && !Array.isArray(raw)
          ? raw as Record<string, unknown> : {};
        const field = tracker?.fields.find((item) => item.id === entry.field);
        const method = entry.method;
        if (!field || typeof method !== "string" ||
          !SUMMARY_METHODS[field.type].includes(method as SummaryMethod)) {
          diagnostics.push(warning(context, `/spec/kanban/summary/${index}`, "KANBAN_SUMMARY_UNSUPPORTED", {
            ja: `集計の項目または方式を確認してください: ${String(entry.field ?? "")}`,
            en: `Check the summary field and method: ${String(entry.field ?? "")}`
          }));
        } else {
          summaries.push({ field, method: method as SummaryMethod });
        }
      });
    }
  }

  return {
    statuses,
    fields: tracker?.fields ?? [],
    cardFields,
    summaries,
    ...(orderField ? { orderField } : {}),
    diagnostics
  };
}

export function kanbanView(context: PluginViewContext): PluginListViewDescriptor {
  const data = resolveKanbanDefinition(context);
  const trackerName = context.target?.kind === "TicketTracker"
    ? context.target.name
    : "";
  return {
    type: "list",
    id: BOARD_VIEW_ID,
    kind: "Ticket",
    paperWidth: "full",
    title: context.target?.title ?? { ja: "カンバン", en: "Kanban" },
    columns: [
      { id: "title", label: { ja: "タイトル", en: "Title" }, type: "text" },
      {
        id: STATUS_KEY,
        label: { ja: "ステータス", en: "Status" },
        type: "select",
        options: data.statuses.map((status) => ({ value: status.id, label: status.label }))
      }
    ],
    scopeFilters: [
      {
        columnId: TRACKERS_KEY,
        operator: "contains",
        value: trackerName
      }
    ],
    rendererData: data
  };
}
