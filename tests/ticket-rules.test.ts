import { expect, it } from "vitest";
import { readTrackers, trackerDefinitionDiagnostics, projectTicket } from "../packages/ticket-engine/src/index.js";
import type { PluginResourceRecord } from "@vellym/plugin-api";
const record = (kind: string, spec: Record<string, unknown>): PluginResourceRecord => ({ kind, spec, name: kind, title: kind, relativePath: `${kind}.yaml`, readOnly: false });
const base = { statuses: [{ id: "open", label: "Open", category: "open" }, { id: "done", label: "Done", category: "closed" }], fields: ["a", "b", "c"].map(id => ({ id, type: "text" })) };
const rules = [{ id: "r", when: { status: ["open"], statusCategory: "open" }, require: ["a"], equals: { b: ["x", "y"] }, empty: ["c"] }];
const make = (rs: unknown) => { const tracker = record("TicketTracker", { ...base, ...(rs === undefined ? {} : { rules: rs }) }); return { tracker, trackers: readTrackers({ records: () => [tracker] }) }; };
it("checks conditions, emptiness and array membership", () => {
 const { trackers } = make(rules);
 const check = (status: string, fields: unknown) => projectTicket(trackers, record("Ticket", { status, fields }))?.diagnostics?.filter(d => d.code === "TICKET_RULE_VIOLATION") ?? [];
 expect(check("open", { a: "", b: "z", c: "x" })).toHaveLength(3);
 for (const empty of [undefined, null, "", []]) expect(check("open", { a: empty, b: ["x"], c: empty })).toHaveLength(1);
 expect(check("open", { a: false, b: ["x"], c: [] })).toHaveLength(0);
 expect(check("done", {})).toHaveLength(0);
 expect(projectTicket(make(undefined).trackers, record("Ticket", { status: "open" }))?.diagnostics ?? []).toHaveLength(0);
});
it("warns and ignores invalid definitions independently", () => {
 const invalid = [{ when: { status: ["missing"] }, require: ["a"] }, { require: ["missing"] }, { when: { statusCategory: "bad" }, empty: ["a"] }, {}, { require: "a" }];
 const { tracker, trackers } = make([...invalid, { require: ["a"] }]);
 expect(trackerDefinitionDiagnostics([tracker]).filter(d => d.code === "TICKET_RULE_INVALID")).toHaveLength(5);
 expect(projectTicket(trackers, record("Ticket", { status: "open" }))?.diagnostics?.filter(d => d.code === "TICKET_RULE_VIOLATION")).toHaveLength(1);
});
