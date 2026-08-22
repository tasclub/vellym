import { definePlugin } from "@vellym/plugin-api";
import {
  TICKET_KIND,
  TRACKER_KIND,
  folderOf,
  initialTicketSpec,
  readTrackers,
  trackerDefinitionDiagnostics,
  trackerFor
} from "./definitions.js";
import { projectTicket } from "./projection.js";
import {
  CREATE_COMMAND_ID,
  CREATE_TRACKER_COMMAND_ID,
  DETAIL_VIEW_ID,
  LIST_VIEW_ID,
  SETTINGS_VIEW_ID,
  ticketDetailView,
  ticketListView,
  ticketTrackerSettingsView
} from "./views.js";
import { TICKET_SPEC_SCHEMA, TICKET_TRACKER_SPEC_SCHEMA } from "./schemas.js";
import { ticketName, trackerName } from "./ulid.js";
import { TICKET_ICON, TICKET_TRACKER_ICON } from "./icons.js";

export default definePlugin({
  activate(host) {
    // 個々のチケットは文書ツリーへ出さない。文書と作業を同じ木に混ぜない。
    host.registerKind({
      kind: TICKET_KIND,
      specSchema: TICKET_SPEC_SCHEMA,
      showInDocumentTree: false,
      icon: TICKET_ICON
    });
    // チケット管理そのものはツリーへ出す。工程の階層に置いた位置に現れ、
    // そこが一覧への入口になる。本文は持たない。
    host.registerKind({
      kind: TRACKER_KIND,
      specSchema: TICKET_TRACKER_SPEC_SCHEMA,
      showInDocumentTree: true,
      hasBlocks: false,
      icon: TICKET_TRACKER_ICON
    });

    // 定義を先に解決してからprojectorを作る。projectorはチケット1件ごとに
    // 呼ばれるため、その中で定義を引き直さない。
    host.registerRecordProjection(TICKET_KIND, (context) => {
      for (const diagnostic of trackerDefinitionDiagnostics(context.records(TRACKER_KIND))) {
        context.reportDiagnostic?.(diagnostic);
      }
      const trackers = readTrackers(context);
      return (record) => projectTicket(trackers, record);
    });

    // チケット管理を開くと、その配下のチケット一覧になる。
    host.registerView({
      id: LIST_VIEW_ID,
      view: ticketListView,
      opensKind: TRACKER_KIND,
      static: true
    });
    // チケット管理そのものの設定。同じkindの2つ目のビューとして登録する。
    host.registerView({
      id: SETTINGS_VIEW_ID,
      view: ticketTrackerSettingsView,
      opensKind: TRACKER_KIND,
      label: { ja: "このチケット管理の設定", en: "Tracker settings" },
      // 定義の編集は静的版に出さない。
      static: false
    });
    host.registerView({
      id: DETAIL_VIEW_ID,
      view: ticketDetailView,
      opensKind: TICKET_KIND,
      static: true
    });

    host.registerCommand({
      id: CREATE_COMMAND_ID,
      title: { ja: "チケットを作成", en: "New ticket" },
      // 作成は静的版に出さない。無効な操作をdisabledで残さない。
      static: false,
      // 作る前に尋ねない。押すと初期値だけのドラフトになり、そのまま編集画面へ入る。
      // 作成用の画面と編集用の画面を別に持たない。同じ画面で全部を書く。
      run: (context) => {
        // 所属は置き場所で決まる。開いているチケット管理の配下にある
        // 機械用フォルダへまとめ、管理ファイルと同じ階層へ平らに溜めない。
        const tracker = context.target
          ? trackerFor(readTrackers(context), context.target.relativePath) ??
            readTrackers(context).find((item) => item.name === context.target?.name)
          : undefined;
        const title =
          typeof context.input?.title === "string" ? context.input.title.trim() : "";
        const initial = initialTicketSpec(tracker);
        // 尋ねた必須項目の値を、初期値の上へ重ねる。
        const fields = { ...initial.fields };
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
          // 本文ブロックは必ず用意する。無いと通常のPage編集経路が
          // 「編集できる本文がない」と判断し、内容を書けなくなる。
          spec: {
            ...initial,
            ...(Object.keys(fields).length ? { fields } : {}),
            blocks: [{ id: "description", type: "rich-text", content: "" }]
          }
        });
      }
    });

    // チケット管理そのものを増やす。工程のフォルダへ差し込む操作である。
    host.registerCommand({
      id: CREATE_TRACKER_COMMAND_ID,
      title: { ja: "チケット管理", en: "Ticket tracker" },
      static: false,
      // 文書階層へ置くものなので、ツリーの追加メニューから起こす。
      placement: "document-tree",
      inputs: [
        {
          id: "title",
          label: { ja: "名前", en: "Name" },
          type: "text",
          path: ["title"],
          required: true
        },
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
                message: "名前を入力してください"
              }
            ]
          };
        }
        // 作成先のフォルダはツリーの追加メニューから渡る。
        const requested =
          typeof context.input?.folder === "string" ? context.input.folder.trim() : "";
        const folder =
          requested || (context.target ? folderOf(context.target.relativePath) : "");
        return context
          .createResource({
            kind: TRACKER_KIND,
            name: trackerName(title),
            title,
            ...(folder ? { folder } : {}),
            // ステータスの無いチケットは成立しないため、最小の流れを用意する。
            // 項目は管理対象を利用者が決めるものなので空のままにする。
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
            // 最初の保存前から設定へ連れて行く。空の正本を先に作らない。
            result.ok ? { ...result, openView: SETTINGS_VIEW_ID } : result
          );
      }
    });
  }
});
