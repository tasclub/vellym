import { definePlugin } from "@vellym/plugin-api";
import {
  createTicketCommand,
  createTrackerCommand,
  registerTicketEngine
} from "@vellym-internal/ticket-engine";
import { BOARD_VIEW_ID, kanbanView } from "./board.js";

export default definePlugin({
  activate(host) {
    // 単独導入でもTicket/TicketTrackerを解釈できる。@vellym/ticketsは不要。
    registerTicketEngine(host);
    host.registerView({
      id: BOARD_VIEW_ID,
      view: kanbanView,
      opensKind: "TicketTracker",
      label: { ja: "カンバン", en: "Kanban" },
      static: true
    });
    host.registerCommand(createTrackerCommand(BOARD_VIEW_ID));
    host.registerCommand(createTicketCommand());
  }
});
