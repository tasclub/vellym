import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PageView } from "@vellym-internal/core";
import type { PluginListViewDescriptor, PluginRenderContext } from "@vellym/plugin-api";
import { PluginListPage } from "../packages/ui-react/src/plugin/plugin-area.js";

const view = {
  page: {
    apiVersion: "vellym.tasclub.com/v1",
    kind: "TicketTracker",
    metadata: { name: "tracker", title: "Tracker" },
    spec: {}
  },
  knownBlocks: [],
  relativePath: "tracker.yaml",
  hash: "hash",
  readOnly: false,
  readOnlyReasons: []
} as unknown as PageView;

function markup(paperWidth?: PluginListViewDescriptor["paperWidth"]): string {
  const descriptor: PluginListViewDescriptor = {
    type: "list", id: "board", kind: "Ticket", title: "Board", columns: [],
    ...(paperWidth ? { paperWidth } : {})
  };
  return renderToStaticMarkup(createElement(PluginListPage, {
    payload: { pluginId: "kanban", viewId: "board", descriptor, rows: [], allRows: [], commands: [] },
    view,
    projectRoot: "/projects/demo",
    targetName: "board-tracker",
    uiLocale: "ja",
    showAll: false,
    onToggleShowAll: () => {},
    onNavigate: () => {},
    onSwitchView: () => {},
    onRunCommand: () => {},
    editable: false,
    onBulkChange: async () => [],
    onBulkArchive: async () => [],
    renderer: { mount: () => ({ unmount: () => {} }) }
  }));
}

describe("plugin paper width", () => {
  it("keeps the reading width by default and passes through explicit wide/full requests", () => {
    expect(markup()).not.toContain("data-plugin-paper-width");
    expect(markup("wide")).toContain('data-plugin-paper-width="wide"');
    expect(markup("full")).toContain('data-plugin-paper-width="full"');
    const css = readFileSync("packages/ui-react/src/styles.css", "utf8");
    expect(css).toMatch(/\.document-paper\[data-plugin-paper-width="full"\]\s*\{\s*width: 100%;/);
    expect(css).toMatch(/\.document-paper:has\(\.plugin-list\),\s*\.document-paper\[data-plugin-paper-width="wide"\]/);
  });

  it("puts creation in the same host toolbar for custom WBS and Kanban renderers", () => {
    for (const id of ["wbs", "kanban"]) {
      const descriptor: PluginListViewDescriptor = { type: "list", id, kind: "Ticket",
        title: id, columns: [], paperWidth: "full" };
      const html = renderToStaticMarkup(createElement(PluginListPage, {
        payload: { pluginId: id, viewId: id, descriptor, rows: [], allRows: [],
          commands: [{ id: "ticket.create", title: "チケットを作成" }] },
        view, projectRoot: "/projects/demo", targetName: "tracker", uiLocale: "ja", showAll: false, editable: true,
        onToggleShowAll: () => {}, onNavigate: () => {}, onSwitchView: () => {},
        onRunCommand: () => {}, onBulkChange: async () => [], onBulkArchive: async () => [],
        renderer: { mount: () => ({ unmount: () => {} }) },
        renderContext: {} as PluginRenderContext
      }));
      expect(html).toContain("チケットを作成");
      expect(html).toContain('data-plugin-paper-width="full"');
      expect(html).toMatch(/plugin-list-toolbar[^>]*>[\s\S]*?チケットを作成/);
    }
  });
});
