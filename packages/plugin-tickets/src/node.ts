import { definePlugin } from "@vellym/plugin-api";
import {
  createTicketCommand,
  createTrackerCommand,
  registerTicketEngine
} from "@vellym-internal/ticket-engine";
import {
  DETAIL_VIEW_ID,
  LIST_VIEW_ID,
  SETTINGS_VIEW_ID,
  ticketDetailView,
  ticketListView,
  ticketTrackerSettingsView
} from "./views.js";

/**
 * 公開済み`@vellym/tickets`のNode entry。
 *
 * 共有エンジンを自分で登録するため、既存利用者は`plugins:`を変更しない。
 * このファイルには一覧・詳細・設定というtickets固有のビュー登録だけを残す。
 */
export default definePlugin({
  activate(host) {
    registerTicketEngine(host);

    host.registerView({
      id: LIST_VIEW_ID,
      view: ticketListView,
      opensKind: "TicketTracker",
      label: { ja: "チケット一覧", en: "Ticket list" },
      static: true
    });
    host.registerView({
      id: SETTINGS_VIEW_ID,
      view: ticketTrackerSettingsView,
      opensKind: "TicketTracker",
      label: { ja: "このチケット管理の設定", en: "Tracker settings" },
      static: false
    });
    host.registerView({
      id: DETAIL_VIEW_ID,
      view: ticketDetailView,
      opensKind: "Ticket",
      static: true
    });

    host.registerCommand(createTicketCommand());
    host.registerCommand(createTrackerCommand(SETTINGS_VIEW_ID));
  }
});
