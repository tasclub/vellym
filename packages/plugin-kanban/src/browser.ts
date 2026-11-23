import { defineBrowserPlugin } from "@vellym/plugin-api";
import { reactRenderer } from "@vellym/plugin-api/react";
import { BOARD_VIEW_ID } from "./board.js";
import { KanbanScreen } from "./screen.js";

export default defineBrowserPlugin({
  activate(host) {
    host.registerViewRenderer(BOARD_VIEW_ID, reactRenderer(KanbanScreen));
  }
});
