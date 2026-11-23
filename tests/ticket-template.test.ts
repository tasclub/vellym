import { describe, expect, it, vi } from "vitest";
import type { PluginResourceDraft, PluginResourceRecord } from "@vellym/plugin-api";
import { createTicketCommand } from "../packages/ticket-engine/src/commands.js";
import { readTrackers, trackerDefinitionDiagnostics } from "../packages/ticket-engine/src/definitions.js";
import { TICKET_TRACKER_SPEC_SCHEMA } from "../packages/ticket-engine/src/schemas.js";
import Ajv from "ajv";

const record = (ticketTemplate?: unknown): PluginResourceRecord => ({
  kind: "TicketTracker", name: "tracker", title: "Tracker", relativePath: "tracker.yaml", readOnly: false,
  spec: ticketTemplate === undefined ? {} : { ticketTemplate }
});

describe("ticket body template", () => {
  it.each([
    [undefined, "ja", ""], ["## Shared", "en", "## Shared"],
    [{ ja: "日本語", en: "English" }, "ja", "日本語"],
    [{ ja: "日本語", en: "English" }, "en", "English"],
    [{ ja: "先頭" }, "en", "先頭"], [{ en: "" , ja: "後" }, "en", ""]
  ])("creates a draft from %j in %s", async (template, locale, expected) => {
    const tracker = record(template);
    const createResource = vi.fn(async (draft: PluginResourceDraft) => ({
      ok: true as const, name: draft.name ?? "new", draft: { ...draft, name: draft.name ?? "new", relativePath: "draft.yaml" }
    }));
    await createTicketCommand().run({ records: () => [tracker], target: tracker,
      locale: locale as "ja" | "en", createResource });
    expect(createResource).toHaveBeenCalledWith(expect.objectContaining({
      spec: expect.objectContaining({ blocks: [{ id: "description", type: "rich-text", content: expected }] })
    }));
  });

  it("accepts valid schemas and warns while ignoring invalid templates", () => {
    const validate = new Ajv().compile(TICKET_TRACKER_SPEC_SCHEMA);
    for (const value of ["", "body", { ja: "本文", en: "body" }]) {
      expect(validate({ ticketTemplate: value })).toBe(true);
      expect(readTrackers({ records: () => [record(value)] })[0]?.ticketTemplate).toEqual(value);
      expect(trackerDefinitionDiagnostics([record(value)])).toEqual([]);
    }
    for (const value of [null, 3, [], {}, { ja: 3 }, { ja: "ok", en: false }]) {
      expect(validate({ ticketTemplate: value })).toBe(false);
      expect(readTrackers({ records: () => [record(value)] })[0]?.ticketTemplate).toBeUndefined();
      expect(trackerDefinitionDiagnostics([record(value)])).toEqual([expect.objectContaining({
        code: "TICKET_TEMPLATE_INVALID", severity: "warning", path: "/spec/ticketTemplate"
      })]);
    }
  });
});
