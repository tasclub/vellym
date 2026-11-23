import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PageView } from "@vellym-internal/core";
import { PluginDetailPanel } from "../packages/ui-react/src/plugin/plugin-area.js";
import type { PluginViewPayload } from "../packages/ui-react/src/plugin/plugin-list-view.js";
import "../packages/ui-react/src/shared/i18n.js";

// ticket-01m7k6gftnq66d3qh00knvzbnc: reading hides empty optional fields, multi-line fields span the row.
const payload = {
  pluginId: "example",
  viewId: "example.detail",
  descriptor: {
    type: "detail",
    id: "example.detail",
    kind: "Item",
    body: "blocks",
    fields: [
      { id: "owner", label: "Owner", type: "text", path: ["fields", "owner"], valueKey: "fields.owner" },
      { id: "due", label: "Due", type: "date", path: ["fields", "due"] },
      { id: "code", label: "Code", type: "text", path: ["fields", "code"], required: true },
      { id: "notes", label: "Notes", type: "multiline", path: ["fields", "notes"], valueKey: "fields.notes" }
    ]
  },
  target: { name: "item-1", values: { "fields.owner": "Kim", "fields.notes": "Line one" } },
  rows: [],
  allRows: [],
  commands: []
} as unknown as PluginViewPayload;

const view = {
  page: { apiVersion: "vellym.tasclub.com/v1", kind: "Item", metadata: { name: "item-1", title: "Item" }, spec: { fields: { owner: "Kim", notes: "Line one" } } },
  knownBlocks: [], relativePath: "item-1.yaml", hash: "h", readOnly: false, readOnlyReasons: [],
  locale: "en", baseLocale: "en", availableLocales: ["en"], editableLocales: ["en"], isBaseLocale: true
} as unknown as PageView;

const render = (editing: boolean) => renderToStaticMarkup(createElement(PluginDetailPanel, {
  payload, view, uiLocale: "en", editing, onChange: () => undefined, onSave: async () => undefined
}));

describe("plugin detail fields", () => {
  it("hides empty optional fields while reading and keeps required ones with a dash", () => {
    const html = render(false);
    expect(html).toContain("Owner");
    expect(html).not.toContain("Due");
    expect(html).toContain("Code");
    expect(html).toContain("—");
  });
  it("shows every field while editing", () => {
    const html = render(true);
    for (const label of ["Owner", "Due", "Code", "Notes"]) expect(html).toContain(label);
  });
  it("marks only multi-line fields as wide", () => {
    const html = render(true);
    expect(html.match(/data-wide=""/g)).toHaveLength(1);
    expect(html).toMatch(/data-wide=""[^>]*>[\s\S]*?Notes/);
  });
});
