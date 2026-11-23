import { describe, expect, it } from "vitest";
// @ts-expect-error JavaScript build helper has no declaration file
import { demoteHeadings, llmsFull, llmsIndex, pageOrder } from "../scripts/site-llms.mjs";

describe("site llms generation", () => {
  it("demotes headings outside matching fences only", () => {
    const source = "# A\n## B\n###### C\n#no\n```js\n# code\n~~~\n# still code\n```\n~~~\n# code\n~~~\n# end";
    expect(demoteHeadings(source)).toBe("## A\n### B\n###### C\n#no\n```js\n# code\n~~~\n# still code\n```\n~~~\n# code\n~~~\n## end");
  });
  it("orders nested folders depth first", () => {
    const repository = { data: { pages: [
      { name: "b", relativePath: "b.yaml" }, { name: "c", relativePath: "sub/c.yaml" },
      { name: "a", relativePath: "a.yaml" }
    ], folders: [{ path: "", order: ["a.yaml", "sub", "b.yaml"] }, { path: "sub", order: ["c.yaml"] }] } };
    expect(pageOrder(repository).map((page: { name: string }) => page.name)).toEqual(["a", "c", "b"]);
  });
  it("creates ordered indexes and expands only prose links", () => {
    const pages = [{ name: "a", title: "A", url: "https://example/a", content: "# Title\n[[a|label]] [[unknown]] `[[a]]`\n```\n[[a]]\n```" }];
    const index = llmsIndex({ pagesByLocale: { ja: pages, en: pages }, schemas: [] });
    expect(index.indexOf("## 日本語")).toBeLessThan(index.indexOf("## English"));
    expect(index.indexOf("## Full text")).toBeLessThan(index.indexOf("## Schemas"));
    const full = llmsFull({ locale: "en", pages });
    expect(full).toContain("1. [A](https://example/a)");
    expect(full).toContain("## A\nSource: https://example/a\n\n## Title");
    expect(full).toContain("[label](https://example/a) [[unknown]] `[[a]]`");
    expect(full).toContain("```\n[[a]]\n```");
  });
});
