import { describe, expect, it } from "vitest";
import {
  assessPageEditing,
  assessRichTextEditing,
  type PageView,
  type RichTextBlock
} from "@vellym-internal/core";

const block = (content: string): RichTextBlock => ({
  id: "body",
  type: "rich-text",
  format: "commonmark",
  content
});

function view(content: string): PageView {
  const body = block(content);
  return {
    page: {
      apiVersion: "vellym.tasclub.com/v1alpha1",
      kind: "Page",
      metadata: { name: "sample", title: "Sample" },
      spec: { blocks: [body] }
    },
    knownBlocks: [body],
    relativePath: "sample.yaml",
    hash: "a".repeat(64),
    readOnly: false,
    readOnlyReasons: []
  };
}

describe("rich-text editing support", () => {
  it("accepts the adopted CommonMark subset", () => {
    const result = assessRichTextEditing([
      block([
        "## Heading",
        "",
        "**bold** and *emphasis* with [link](https://example.com) and `code`.",
        "",
        "- list",
        "",
        "> quote",
        "",
        "```ts",
        "const value = true",
        "```"
      ].join("\n"))
    ]);

    expect(result).toEqual({ supported: true, reasons: [] });
  });

  it("reports genuinely unsupported syntax instead of silently normalizing it", () => {
    const result = assessRichTextEditing([block("![diagram](diagram.png)")]);

    expect(result.supported).toBe(false);
    expect(result.reasons).toEqual(["画像を含む本文はリッチ編集できません"]);
  });

  it("keeps HTML, horizontal rules and tables editable rather than locking", () => {
    const result = assessRichTextEditing([
      block("<div>raw</div>\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |")
    ]);

    expect(result).toEqual({ supported: true, reasons: [] });
  });

  it("keeps a page editable when an unknown block sits alongside a known one", () => {
    const sample = view("本文");
    sample.page.spec.blocks.push({ id: "diagram", type: "diagram" });

    const result = assessPageEditing(sample);
    // The known rich-text block stays editable; the unknown block is preserved
    // untouched on save rather than locking the whole page (RELUX-17).
    expect(result.supported).toBe(true);
    expect(result.blocks).toEqual([
      { id: "body", supported: true, reasons: [] }
    ]);
  });

  it("marks only the offending block uneditable in a mixed page", () => {
    const editable = block("編集できる本文");
    editable.id = "intro";
    const locked = block("![diagram](diagram.png)");
    locked.id = "raw";
    const sample = view("placeholder");
    sample.page.spec.blocks = [editable, locked];
    sample.knownBlocks = [editable, locked];

    const result = assessPageEditing(sample);
    expect(result.supported).toBe(true);
    expect(result.blocks).toEqual([
      { id: "intro", supported: true, reasons: [] },
      {
        id: "raw",
        supported: false,
        reasons: ["画像を含む本文はリッチ編集できません"]
      }
    ]);
  });

  it("locks a whole page flagged read-only regardless of blocks", () => {
    const sample = view("本文");
    sample.readOnly = true;
    sample.readOnlyReasons = ["YAMLエイリアスを含むため編集できません"];

    expect(assessPageEditing(sample)).toEqual({
      supported: false,
      reasons: ["YAMLエイリアスを含むため編集できません"],
      blocks: []
    });
  });
});
