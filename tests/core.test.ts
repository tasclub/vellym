import { describe, expect, it } from "vitest";
import {
  API_VERSION,
  STABLE_API_VERSION,
  isVellymCandidate,
  knownRichTextBlocks,
  validatePage,
  type Page
} from "@vellym-internal/core";

const page: Page = {
  apiVersion: API_VERSION,
  kind: "Page",
  metadata: { name: "test-page", title: "Test page" },
  spec: {
    blocks: [
      {
        id: "body",
        type: "rich-text",
        format: "commonmark",
        content: "Hello"
      }
    ]
  }
};

describe("page schema", () => {
  it("accepts the approved envelope", () => {
    expect(validatePage(page, "page.yaml").page).toEqual(page);
  });

  it("accepts the stable v1 envelope", () => {
    const stable = { ...page, apiVersion: STABLE_API_VERSION };
    expect(validatePage(stable, "page.yaml").page).toEqual(stable);
    expect(isVellymCandidate(stable)).toBe(true);
  });

  it("rejects a missing required title", () => {
    const value = {
      ...page,
      metadata: { name: "test-page" }
    };
    expect(validatePage(value, "page.yaml").diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PAGE_SCHEMA" })])
    );
  });

  it("localizes schema diagnostics to Japanese (RELUX-02)", () => {
    const value = {
      ...page,
      metadata: { name: "test-page" }
    };
    const { diagnostics } = validatePage(value, "page.yaml");
    expect(diagnostics.some((item) => item.message.includes("必須項目"))).toBe(
      true
    );
  });

  it("ignores another apiVersion even when kind is Page", () => {
    expect(isVellymCandidate({ apiVersion: "example.com/v1", kind: "Page" })).toBe(false);
  });

  it("keeps unknown blocks out of the known renderer list", () => {
    const withUnknown: Page = {
      ...page,
      spec: {
        blocks: [
          ...page.spec.blocks,
          { type: "vendor.example/widget", payload: { anything: true } }
        ]
      }
    };
    expect(knownRichTextBlocks(withUnknown, "page.yaml").blocks).toHaveLength(1);
  });

  it("diagnoses duplicate known block IDs without rejecting the page", () => {
    const duplicate: Page = {
      ...page,
      spec: { blocks: [...page.spec.blocks, { ...page.spec.blocks[0] }] }
    };
    expect(knownRichTextBlocks(duplicate, "page.yaml").diagnostics[0]?.code).toBe(
      "DUPLICATE_BLOCK_ID"
    );
  });
});
