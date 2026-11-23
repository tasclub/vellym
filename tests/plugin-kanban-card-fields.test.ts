import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@vellym-internal/ticket-engine";
import { cardFieldValue } from "../packages/plugin-kanban/src/card-fields.js";

const field = (type: FieldDefinition["type"]): FieldDefinition => ({
  id: "test", label: "Test", type, required: false, listColumn: false, filter: false, sort: false, multiple: false,
  options: [{ value: "high", label: "高" }]
});

describe("Kanban card fields", () => {
  it("uses field labels, boolean symbols and date-only strings", () => {
    expect(cardFieldValue(field("select"), "high", "ja")).toBe("高");
    expect(cardFieldValue(field("multiselect"), ["high", "other"], "ja")).toBe("高, other");
    expect(cardFieldValue(field("boolean"), false, "ja")).toBe("□ いいえ");
    expect(cardFieldValue(field("boolean"), true, "en")).toBe("✓ Yes");
    expect(cardFieldValue(field("boolean"), true, "fr")).toBe("✓ Yes");
    expect(cardFieldValue(field("date"), "2026-10-04", "ja")).toBe("2026-10-04");
    expect(cardFieldValue(field("number"), 0, "ja")).toBe("0");
    expect(cardFieldValue(field("text"), null, "ja")).toBeUndefined();
  });
});
