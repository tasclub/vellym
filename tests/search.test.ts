import { describe, expect, it } from "vitest";
import { searchPages, type PageView } from "@vellym-internal/core";

function view(
  name: string,
  title: string,
  relativePath: string,
  content: string
): PageView {
  return {
    page: {
      apiVersion: "vellym.tasclub.com/v1alpha1",
      kind: "Page",
      metadata: { name, title },
      spec: {
        blocks: [{ id: "body", type: "rich-text", format: "commonmark", content }]
      }
    },
    knownBlocks: [{ id: "body", type: "rich-text", format: "commonmark", content }],
    relativePath,
    hash: "a".repeat(64),
    readOnly: false,
    readOnlyReasons: []
  };
}

describe("full text search", () => {
  const pages = [
    view("charter", "プロジェクト憲章", "project/charter.yaml", "## 目的\n\n安全な文書管理を提供する。"),
    view("requirements", "要求一覧", "requirements/core.yaml", "## 保存\n\n競合から文書を保護する。")
  ];

  it("searches titles and body with hierarchy, heading, and snippet", () => {
    expect(searchPages(pages, "安全")).toMatchObject({
      indexedPages: 2,
      total: 1,
      results: [{
        pageId: "charter",
        title: "プロジェクト憲章",
        breadcrumbs: ["project"],
        heading: { id: "目的", text: "目的" },
        snippet: "安全な文書管理を提供する。"
      }]
    });
  });

  it("normalizes width and case, and ranks title matches first", () => {
    const result = searchPages(
      [...pages, view("plan", "Project Plan", "plan.yaml", "本文")],
      "ＰＲＯＪＥＣＴ"
    );
    expect(result.results[0]?.pageId).toBe("plan");
  });
});
