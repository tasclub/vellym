import { describe, expect, it } from "vitest";
import type { RichTextBlock } from "@vellym-internal/core";
import {
  draftCopyText,
  parseRepositoryEvent,
  sameDraft,
  type SaveState
} from "../packages/ui-react/src/editor/save-state.js";

const block = (content: string): RichTextBlock => ({
  id: "body",
  type: "rich-text",
  format: "commonmark",
  content
});

describe("save state support", () => {
  it("defines the six save lifecycle states separately from read-only and watch state", () => {
    const states: SaveState[] = [
      "saved",
      "dirty",
      "saving",
      "success",
      "failure",
      "conflict"
    ];

    expect(new Set(states).size).toBe(6);
  });

  it("detects edits made while an earlier save is in flight", () => {
    const submitted = { title: "Title", blocks: [block("Submitted")] };

    expect(sameDraft(submitted, submitted)).toBe(true);
    expect(
      sameDraft(submitted, {
        title: "Title",
        blocks: [block("Edited while saving")]
      })
    ).toBe(false);
  });

  it("copies the editable title and body without internal block identifiers", () => {
    expect(
      draftCopyText("Sample", [
        block("First paragraph"),
        { ...block("Second paragraph"), id: "details" }
      ])
    ).toBe("# Sample\n\nFirst paragraph\n\nSecond paragraph\n");
  });

  it("accepts only versioned watcher events", () => {
    expect(
      parseRepositoryEvent(
        JSON.stringify({
          version: 4,
          kind: "repository-change",
          watcher: "connected"
        })
      )
    ).toEqual({
      version: 4,
      kind: "repository-change",
      watcher: "connected"
    });
    expect(parseRepositoryEvent("{}")).toBeUndefined();
    expect(parseRepositoryEvent("not-json")).toBeUndefined();
  });
});
