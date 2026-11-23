import { definePlugin } from "@vellym/plugin-api";
import { createTicketCommand, createTrackerCommand, registerTicketEngine } from "@vellym-internal/ticket-engine";
import { wbsView, WBS_VIEW_ID } from "./view.js";

export default definePlugin({
  activate(host) {
    registerTicketEngine(host);
    host.registerView({ id: WBS_VIEW_ID, view: wbsView, opensKind: "TicketTracker",
      label: { ja: "WBS", en: "WBS" }, static: true });
    host.registerCommand(createTrackerCommand(WBS_VIEW_ID));
    host.registerCommand(createTicketCommand());
  }
});
