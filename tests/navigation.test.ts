import { describe, expect, it } from "vitest";
import {
  buildDocumentNavigation,
  extractDocumentHeadings,
  type PageSummary
} from "@vellym-internal/core";

const pages: PageSummary[] = [
  { name: "charter", title: "憲章", relativePath: "project/charter.yaml", readOnly: false },
  { name: "requirement", title: "要求", relativePath: "requirements/core.yaml", readOnly: false },
  { name: "decision", title: "判断", relativePath: "decisions/core.yaml", readOnly: false }
];

describe("document navigation", () => {
  it("projects folders, breadcrumbs, and previous/next pages", () => {
    const navigation = buildDocumentNavigation(pages);
    expect(navigation.tree).toHaveLength(3);
    expect(navigation.pages[1]).toMatchObject({
      breadcrumbs: ["requirements"],
      previous: { name: "charter" },
      next: { name: "decision" }
    });
  });

  it("creates stable unique anchors for CommonMark headings", () => {
    expect(
      extractDocumentHeadings([
        {
          id: "body",
          type: "rich-text",
          format: "commonmark",
          content: "## 概要\n\n本文\n\n概要\n----\n\n## 概要"
        }
      ])
    ).toEqual([
      { depth: 2, id: "概要", text: "概要" },
      { depth: 2, id: "概要-2", text: "概要" },
      { depth: 2, id: "概要-3", text: "概要" }
    ]);
  });

  it("uses folder display names, empty folders, and explicit child order", () => {
    const navigation = buildDocumentNavigation(
      pages,
      new Map(),
      [
        {
          path: "",
          name: "",
          title: "文書",
          order: ["requirements", "project"],
          readOnly: false,
          readOnlyReasons: []
        },
        {
          path: "project",
          name: "project",
          title: "プロジェクト",
          order: [],
          readOnly: false,
          readOnlyReasons: []
        },
        {
          path: "requirements",
          name: "requirements",
          title: "要求",
          order: [],
          readOnly: false,
          readOnlyReasons: []
        },
        {
          path: "empty",
          name: "empty",
          title: "空フォルダ",
          order: [],
          readOnly: false,
          readOnlyReasons: []
        }
      ]
    );

    expect(navigation.tree.map((node) =>
      node.kind === "folder" ? node.title : node.title
    )).toEqual(["要求", "プロジェクト", "decisions", "空フォルダ"]);
    expect(navigation.pages.map((page) => page.name)).toEqual([
      "requirement",
      "charter",
      "decision"
    ]);
  });

  it("builds a 30,000-page tree without quadratic summary lookups", () => {
    const large = Array.from({ length: 30_000 }, (_, index): PageSummary => ({
      name: `page-${index}`,
      title: `Page ${index}`,
      relativePath: `items/${String(index).padStart(5, "0")}.yaml`,
      readOnly: false
    }));
    const started = performance.now();
    const navigation = buildDocumentNavigation(large, new Map(), [{
      path: "items",
      name: "items",
      title: "Items",
      order: [],
      readOnly: false,
      readOnlyReasons: []
    }]);
    expect(navigation.pages).toHaveLength(30_000);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
