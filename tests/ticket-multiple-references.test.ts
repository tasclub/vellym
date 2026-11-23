import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import type { PluginIndexRow, PluginResourceRecord } from "@vellym/plugin-api";
import { summarizeRows } from "../packages/plugin-api/src/summary.js";
import {
  initialFieldValue,
  initialTicketSpec,
  readTrackers,
  trackerDefinitionDiagnostics
} from "../packages/ticket-engine/src/definitions.js";
import { TICKET_TRACKER_SPEC_SCHEMA } from "../packages/ticket-engine/src/schemas.js";
import { projectTicket } from "../packages/ticket-engine/src/projection.js";
import { validateTicketReferences } from "../packages/ticket-engine/src/references.js";

/**
 * `reference`項目の`multiple: true`。**新しい型ではなく修飾**であるため、
 * 既存のYAML・JSON Schemaはそのまま動き、`multiple`を書いた項目だけが
 * 文字列の配列を持つ。配列の振る舞いは`multiselect`と同じにする。
 */

const trackerRecord = (fields: Record<string, unknown>[], extra: Record<string, unknown> = {}): PluginResourceRecord => ({
  kind: "TicketTracker",
  name: "refs",
  title: "Refs",
  relativePath: "refs.yaml",
  readOnly: false,
  spec: { fields, ...extra }
});

const refsFields = [
  { id: "parent", type: "reference" },
  { id: "dependsOn", type: "reference", multiple: true }
];

const tracker = readTrackers({ records: () => [trackerRecord(refsFields, { hierarchy: { parentField: "parent" } })] })[0]!;

const ticket = (name: string, fields: Record<string, unknown>): PluginResourceRecord => ({
  kind: "Ticket",
  name,
  title: name,
  relativePath: `refs/${name}.yaml`,
  readOnly: false,
  spec: { status: "open", fields }
});

const project = (record: PluginResourceRecord) =>
  projectTicket(readTrackers({ records: () => [trackerRecord(refsFields, { hierarchy: { parentField: "parent" } })] }), record);

describe("multiple on reference fields", () => {
  it("parses multiple for reference fields only, defaulting to false", () => {
    const [parsed] = readTrackers({ records: () => [trackerRecord(refsFields)] });
    expect(parsed?.fields.find((field) => field.id === "parent")?.multiple).toBe(false);
    expect(parsed?.fields.find((field) => field.id === "dependsOn")?.multiple).toBe(true);
  });

  it("warns when multiple is declared on fields other than reference", () => {
    const diagnostics = trackerDefinitionDiagnostics([
      trackerRecord([
        { id: "flag", type: "boolean", multiple: true },
        { id: "tags", type: "multiselect", multiple: true },
        { id: "broken", type: "reference", multiple: "yes" }
      ])
    ]);
    const warnings = diagnostics.filter((item) => item.code === "TICKET_FIELD_MULTIPLE_UNSUPPORTED");
    expect(warnings.map((item) => item.path)).toEqual([
      "/spec/fields/0/multiple",
      "/spec/fields/1/multiple",
      "/spec/fields/2/multiple"
    ]);
    expect(warnings.every((item) => item.severity === "warning")).toBe(true);
    // 警告でも値は動く。multipleはfalseで持つ（brokenはreferenceだがtrueではない）
    const [parsed] = readTrackers({ records: () => [trackerRecord([{ id: "flag", type: "boolean", multiple: true }])] });
    expect(parsed?.fields[0]?.multiple).toBe(false);
  });

  it("rejects a multiple reference as the hierarchy parent field", () => {
    const record = trackerRecord(refsFields, { hierarchy: { parentField: "dependsOn" } });
    const [parsed] = readTrackers({ records: () => [record] });
    expect(parsed?.parentField).toBeUndefined();
    expect(trackerDefinitionDiagnostics([record]).map((item) => item.code)).toContain("TICKET_PARENT_FIELD_INVALID");
  });

  it("indexes array values and reports type mismatches without dropping the value", () => {
    const good = project(ticket("ticket-a", { dependsOn: ["ticket-b", "ticket-c"] }));
    expect(good?.values["field:dependsOn"]).toEqual(["ticket-b", "ticket-c"]);
    expect(good?.diagnostics ?? []).toEqual([]);

    const bad = project(ticket("ticket-b", { dependsOn: "ticket-c" }));
    expect(bad?.values["field:dependsOn"]).toBe("ticket-c");
    expect(bad?.diagnostics?.map((item) => item.code)).toContain("TICKET_FIELD_TYPE_MISMATCH");

    const mixed = project(ticket("ticket-c", { dependsOn: ["ticket-d", 7] }));
    expect(mixed?.diagnostics?.map((item) => item.code)).toContain("TICKET_FIELD_TYPE_MISMATCH");
  });

  it("warns about unresolved and self references for each entry of the array", () => {
    const rows: PluginIndexRow[] = [
      { name: "ticket-a", title: "a", values: { tracker: "refs", trackers: ["refs"], "field:dependsOn": ["ticket-nowhere", "ticket-a"] } },
      { name: "ticket-b", title: "b", values: { tracker: "refs", trackers: ["refs"], "field:dependsOn": ["ticket-a", "ticket-b"] } }
    ];
    const diagnostics = validateTicketReferences(rows, { records: () => [trackerRecord(refsFields, { hierarchy: { parentField: "parent" } })] });
    expect(diagnostics.filter((item) => item.code === "TICKET_REFERENCE_UNRESOLVED").map((item) => `${item.file} ${item.severity}`))
      .toEqual(["ticket-a warning"]);
    expect(diagnostics.filter((item) => item.code === "TICKET_REFERENCE_SELF").map((item) => `${item.file} ${item.severity}`))
      .toEqual(["ticket-a warning", "ticket-b warning"]);
  });

  it("starts a multiple reference at an empty array and leaves a single one unset", () => {
    const dependsOn = tracker.fields.find((field) => field.id === "dependsOn")!;
    const parent = tracker.fields.find((field) => field.id === "parent")!;
    expect(initialFieldValue(dependsOn)).toEqual([]);
    expect(initialFieldValue(parent)).toBeUndefined();
    expect(initialTicketSpec(tracker)).toEqual({ fields: { dependsOn: [] } });
  });

  it("counts and breaks down the same way as multiselect summaries", () => {
    const rows: PluginIndexRow[] = [
      { name: "ticket-a", title: "a", values: { "field:dependsOn": ["ticket-b", "ticket-c"] } },
      { name: "ticket-b", title: "b", values: { "field:dependsOn": ["ticket-c"] } },
      { name: "ticket-c", title: "c", values: {} },
      { name: "ticket-d", title: "d", values: { "field:dependsOn": "ticket-c" } }
    ];
    // 件数はmultiselectと同じ「値を持つ行の数」。内訳は各値を数える。
    const count = summarizeRows(rows, "field:dependsOn", "reference", "count", "ja");
    expect(count.text).toBe("件数: 3");
    // 単一参照の定義に配列が入った行は数えない（projectionがすでに警告している）。
    const strict = summarizeRows(rows.slice(0, 3), "field:dependsOn", "reference", "count", "ja");
    expect(strict.text).toBe("件数: 2");
    // 内訳はmultiselectと同じ値ごとの数え上げ。型不適合の配列も値として数える
    // （不適合自体はprojectionの警告で示し、集計で隠さない）。
    const breakdown = summarizeRows(rows, "field:dependsOn", "reference", "breakdown", "ja");
    expect(breakdown.text).toBe("内訳: ticket-b 1、ticket-c 3");
    const strictBreakdown = summarizeRows(rows.slice(0, 3), "field:dependsOn", "reference", "breakdown", "ja");
    expect(strictBreakdown.text).toBe("内訳: ticket-b 1、ticket-c 2");
  });

  it("groups by a multiple reference splitting each entry like multiselect", () => {
    const rows: PluginIndexRow[] = [
      { name: "ticket-a", title: "a", values: { "field:dependsOn": ["ticket-x", "ticket-y"], "field:counted": 1 } },
      { name: "ticket-b", title: "b", values: { "field:dependsOn": ["ticket-x"], "field:counted": 1 } }
    ];
    const result = summarizeRows(rows, "field:counted", "number", "count", "ja", {
      groupBy: { key: "field:dependsOn", type: "reference" }
    });
    expect(result.groups?.map((group) => [group.value, group.text])).toEqual([
      ["ticket-x", "件数: 2"],
      ["ticket-y", "件数: 1"]
    ]);
    expect(result.multiCounted).toBe(true);
  });

  it("accepts multiple in the published tracker JSON Schema", () => {
    // schemaは`spec`そのものへ当てる（ticket-template.test.tsと同じ）。
    const validate = new Ajv({ strict: false }).compile(TICKET_TRACKER_SPEC_SCHEMA);
    expect(validate({
      fields: [{ id: "dependsOn", label: "依存", type: "reference", multiple: true }]
    })).toBe(true);
    expect(validate({
      fields: [{ id: "dependsOn", label: "依存", type: "reference", multiple: "yes" }]
    })).toBe(false);
  });

  it("publishes multiple in the tracker schema that the site serves", () => {
    // 公開されるJSON Schema（ticket-management.yamlから読めるもの）にmultipleが出る。
    const source = readFileSync("packages/ticket-engine/src/schemas.ts", "utf8");
    expect(source).toContain("multiple: { type: \"boolean\" }");
  });
});
