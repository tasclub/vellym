import { defineBrowserPlugin } from "@vellym/plugin-api";
import { reactRenderer } from "@vellym/plugin-api/react";
import { DESIGN_CANVAS_VIEW_ID } from "./model/index.js";
import { DesignCanvasView } from "./render/board-view.js";

export default defineBrowserPlugin({
  activate(host) {
    host.registerViewRenderer(DESIGN_CANVAS_VIEW_ID, reactRenderer(DesignCanvasView));
  }
});
