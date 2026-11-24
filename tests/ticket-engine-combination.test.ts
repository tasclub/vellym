import { describe, expect, it } from "vitest";
import type { PluginResourceRecord } from "@vellym/plugin-api";
import { validateTrackerCombinations } from "../packages/ticket-engine/src/definitions.js";

const statuses = [{ id: "open", category: "open" }, { id: "done", category: "closed" }];
function tracker(relativePath: string, spec: Record<string, unknown> = {}): PluginResourceRecord {
  return { kind: "TicketTracker", name: relativePath, title: relativePath, relativePath, readOnly: false,
    spec: { statuses, kanban: { orderField: "board" }, wbs: { orderField: "tree" }, ...spec } };
}
function check(records: PluginResourceRecord[]) {
  return validateTrackerCombinations([], { records: () => records });
}

describe("tracker combination warnings", () => {
  it("compares status sets and categories across all ancestors, ignoring order and siblings", () => {
    const root = tracker("root.yaml");
    const middle = tracker("a/tracker.yaml", { statuses: [...statuses].reverse() });
    const child = tracker("a/b/tracker.yaml");
    expect(check([root, middle, child])).toEqual([]);
    const changedId = tracker("a/b/tracker.yaml", { statuses: [{ id: "other", category: "open" }] });
    const changedCategory = tracker("a/b/tracker.yaml", { statuses: [statuses[0], { id: "done", category: "open" }] });
    for (const changed of [changedId, changedCategory]) {
      const warnings = check([root, middle, changed]);
      expect(warnings).toHaveLength(2);
      expect(warnings.every(w => w.file === changed.relativePath && w.severity === "warning" &&
        w.code === "TICKET_TRACKER_STATUSES_MISMATCH" && typeof w.message !== "string" &&
        w.message.ja && w.message.en)).toBe(true);
    }
    expect(check([tracker("a/tracker.yaml"), tracker("ab/tracker.yaml", { statuses: [] })])).toEqual([]);
  });

  it("warns for identical order fields including omitted defaults", () => {
    for (const spec of [
      { kanban: { orderField: "rank" }, wbs: { orderField: "rank" } },
      { kanban: {}, wbs: {} },
      { kanban: { orderField: "order" }, wbs: {} }
    ]) {
      const warnings = check([tracker("tracker.yaml", spec)]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ file: "tracker.yaml", severity: "warning", code: "TICKET_ORDER_FIELD_CONFLICT" });
      expect(warnings[0]!.message).toMatchObject({ ja: expect.any(String), en: expect.any(String) });
    }
    expect(check([tracker("tracker.yaml")])).toEqual([]);
  });
});
