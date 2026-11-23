import { defineBrowserPlugin } from "@vellym/plugin-api";
import { reactRenderer } from "@vellym/plugin-api/react";
import { WBS_VIEW_ID } from "./view.js";
import { WBSScreen } from "./screen.js";

export default defineBrowserPlugin({
  activate(host) {
    host.registerViewRenderer(WBS_VIEW_ID, reactRenderer(WBSScreen));
  }
});
