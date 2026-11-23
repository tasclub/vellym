import { describe, expect, it } from "vitest";
import type { PluginDetailViewDescriptor } from "@vellym/plugin-api";
import {
  referenceTargetsOf,
  type PluginViewRow
} from "../packages/runtime-node/src/plugins.js";

const descriptor: PluginDetailViewDescriptor = {
  type: "detail",
  id: "ticket.detail",
  kind: "Ticket",
  body: "blocks",
  fields: [
    { id: "parent", label: "Parent", type: "reference", path: ["fields", "parent"] },
    { id: "dependsOn", label: "Depends on", type: "reference", multiple: true, path: ["fields", "dependsOn"] }
  ]
};

const row = (name: string, title: string, values: Record<string, unknown>): PluginViewRow =>
  ({ name, title, relativePath: `${name}.yaml`, values }) as unknown as PluginViewRow;

describe("referenceTargetsOf", () => {
  it("provides same-tracker targets for single, multiple, and unresolved references", () => {
    const rows = [
      row("source", "Source", {
        parent: "parent",
        dependsOn: ["dependency", "missing"]
      }),
      row("parent", "Parent title", {}),
      row("dependency", "Dependency title", {})
    ];

    expect(referenceTargetsOf(descriptor, rows)).toEqual([
      { name: "source", title: "Source" },
      { name: "parent", title: "Parent title" },
      { name: "dependency", title: "Dependency title" }
    ]);
  });

  it("does not add targets for details without references", () => {
    expect(referenceTargetsOf(
      { ...descriptor, fields: [{ id: "note", label: "Note", type: "text", path: ["fields", "note"] }] },
      [row("source", "Source", {})]
    )).toEqual([]);
  });
});
