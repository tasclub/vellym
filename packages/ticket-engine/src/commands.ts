import type { PluginCommandContribution } from "@vellym/plugin-api";
import {
  TICKET_KIND,
  TRACKER_KIND,
  folderOf,
  initialTicketSpec,
  readTrackers,
  trackerFor
} from "./definitions.js";
import { ticketName, trackerName } from "./ulid.js";

export const CREATE_TICKET_COMMAND_ID = "ticket.create";
export const CREATE_TRACKER_COMMAND_ID = "ticket.create-tracker";

/** Ticket作成処理。ビュー固有の宣言を持たない共有エンジン側に置く。 */
export function createTicketCommand(): PluginCommandContribution {
  return {
    id: CREATE_TICKET_COMMAND_ID,
    title: { ja: "チケットを作成", en: "New ticket" },
    static: false,
    run: (context) => {
      const trackers = readTrackers(context);
      const tracker = context.target
        ? trackerFor(trackers, context.target.relativePath) ??
          trackers.find((item) => item.name === context.target?.name)
        : undefined;
      const title =
        typeof context.input?.title === "string" ? context.input.title.trim() : "";
      const initial = initialTicketSpec(tracker);
      const fields = { ...initial.fields };
      const parent = context.input?.parent;
      const parentField = context.input?.parentField;
      if (typeof parent === "string" && parent && typeof parentField === "string" &&
        tracker?.fields.some((field) => field.id === parentField && field.type === "reference")) {
        fields[parentField] = parent;
      }
      for (const field of tracker?.fields ?? []) {
        if (!field.required) continue;
        const value = context.input?.[field.id];
        if (value !== undefined) fields[field.id] = value;
      }
      return context.createResource({
        kind: TICKET_KIND,
        name: ticketName(),
        title: title || (context.locale === "ja" ? "新しいチケット" : "New ticket"),
        ...(tracker
          ? { folder: tracker.folder ? `${tracker.folder}/+tickets` : "+tickets" }
          : {}),
        spec: {
          ...initial,
          ...(Object.keys(fields).length ? { fields } : {}),
          blocks: [{ id: "description", type: "rich-text", content: "" }]
        }
      });
    }
  };
}

/** TicketTracker作成処理。保存前に開く設定ビューだけ利用側から受け取る。 */
export function createTrackerCommand(settingsViewId: string): PluginCommandContribution {
  return {
    id: CREATE_TRACKER_COMMAND_ID,
    title: { ja: "チケット管理", en: "Ticket tracker" },
    static: false,
    placement: "document-tree",
    inputs: [
      {
        id: "title",
        label: { ja: "名前", en: "Name" },
        type: "text",
        path: ["title"],
        required: true
      }
    ],
    run: (context) => {
      const title =
        typeof context.input?.title === "string" ? context.input.title.trim() : "";
      if (!title) {
        return {
          ok: false,
          diagnostics: [
            {
              file: ".",
              severity: "warning",
              code: "TICKET_TRACKER_TITLE_REQUIRED",
              message: { ja: "名前を入力してください", en: "Enter a name." }
            }
          ]
        };
      }
      const requested =
        typeof context.input?.folder === "string" ? context.input.folder.trim() : "";
      const folder = requested || (context.target ? folderOf(context.target.relativePath) : "");
      return context
        .createResource({
          kind: TRACKER_KIND,
          name: trackerName(title),
          title,
          ...(folder ? { folder } : {}),
          spec: {
            statuses: [
              { id: "todo", label: "未着手", category: "open" },
              { id: "doing", label: "対応中", category: "open" },
              { id: "done", label: "完了", category: "closed" }
            ],
            fields: []
          }
        })
        .then((result) =>
          result.ok ? { ...result, openView: settingsViewId } : result
        );
    }
  };
}
