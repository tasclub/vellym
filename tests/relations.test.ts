import { describe, expect, it } from "vitest";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { PhrasingContent, Root } from "mdast";
import {
  extractWikiLinks,
  formatWikiLink,
  parseWikiLinkBody,
  resolvePageReference,
  transformWikiLinks,
  type InternalPageReference,
  type PageReferenceIndex,
  type RichTextBlock
} from "../packages/core/src/index.js";
import {
  deriveRepositoryEntryIndex,
  extractPageEntry,
  pageRelationsView,
  type PageEntry
} from "../packages/runtime-node/src/repository-entry.js";

function block(content: string, id = "body"): RichTextBlock {
  return { id, type: "rich-text", format: "commonmark", content };
}

describe("wiki link parsing", () => {
  it("splits label at the first pipe and heading at the first hash", () => {
    expect(parseWikiLinkBody("target")).toEqual({ target: "target" });
    expect(parseWikiLinkBody("target|表示名")).toEqual({
      target: "target",
      label: "表示名"
    });
    expect(parseWikiLinkBody("target#見出し")).toEqual({
      target: "target",
      heading: "見出し"
    });
    expect(parseWikiLinkBody("target#見出し|表示名")).toEqual({
      target: "target",
      heading: "見出し",
      label: "表示名"
    });
    expect(parseWikiLinkBody("  spaced  |  label  ")).toEqual({
      target: "spaced",
      label: "label"
    });
  });

  it("treats an empty target as plain text rather than a link", () => {
    expect(parseWikiLinkBody("")).toBeUndefined();
    expect(parseWikiLinkBody("#heading")).toBeUndefined();
    expect(parseWikiLinkBody("|label")).toBeUndefined();
    expect(parseWikiLinkBody("  ")).toBeUndefined();
  });

  it("round-trips through formatWikiLink", () => {
    const parts = { target: "a", heading: "b", label: "c" };
    expect(formatWikiLink(parts)).toBe("[[a#b|c]]");
    expect(parseWikiLinkBody("a#b|c")).toEqual(parts);
    expect(formatWikiLink({ target: "a" })).toBe("[[a]]");
  });
});

describe("wiki link extraction from the syntax tree", () => {
  it("extracts every wiki link shape", () => {
    expect(
      extractWikiLinks([
        block("[[one]] と [[two|表示名]] と [[three#見出し]] と [[four#h|l]]")
      ])
    ).toEqual([
      { blockId: "body", target: "one" },
      { blockId: "body", target: "two", label: "表示名" },
      { blockId: "body", target: "three", heading: "見出し" },
      { blockId: "body", target: "four", heading: "h", label: "l" }
    ]);
  });

  it("ignores code fences, inline code, links, images and external URLs", () => {
    const links = extractWikiLinks([
      block(
        [
          "```",
          "[[fenced]]",
          "```",
          "",
          "`[[inline]]` は対象外。",
          "",
          "[[[nested]]](https://example.com/) も [ラベル](https://example.com/[[url]]) も対象外。",
          "",
          "![[[image]]](./a.png) も対象外。",
          "",
          "[[real]] だけ抽出する。"
        ].join("\n")
      )
    ]);
    expect(links.map(({ target }) => target)).toEqual(["real"]);
  });

  it("deduplicates identical links within a block but keeps distinct ones", () => {
    expect(
      extractWikiLinks([block("[[a]] [[a]] [[a|x]] [[a#h]]")]).map(formatWikiLink)
    ).toEqual(["[[a]]", "[[a|x]]", "[[a#h]]"]);
  });

  it("keeps the block id of each link", () => {
    expect(
      extractWikiLinks([block("[[a]]", "intro"), block("[[b]]", "detail")])
    ).toEqual([
      { blockId: "intro", target: "a" },
      { blockId: "detail", target: "b" }
    ]);
  });
});

describe("reference resolution order", () => {
  const index: PageReferenceIndex = {
    byName: new Map([
      ["page-a", ["page-a"]],
      ["shared", ["by-name"]]
    ]),
    bySlug: new Map([
      ["slug-a", ["page-a"]],
      ["shared", ["by-slug"]],
      ["dup-slug", ["one", "two"]]
    ]),
    byTitle: new Map([
      ["タイトルA", ["page-a"]],
      ["shared", ["by-title"]],
      ["重複", ["one", "two"]]
    ]),
    headings: (pageId) =>
      pageId === "page-a" ? [{ id: "scope", text: "対象範囲" }] : []
  };
  const reference = (target: string, heading?: string): InternalPageReference => ({
    sourcePageId: "source",
    sourceLocale: "",
    sourceBlockId: "body",
    target,
    ...(heading === undefined ? {} : { targetHeading: heading })
  });

  it("matches metadata.name, then slug, then title", () => {
    expect(resolvePageReference(reference("page-a"), index)).toMatchObject({
      status: "resolved",
      matchedBy: "name",
      resolvedTargetPageId: "page-a"
    });
    expect(resolvePageReference(reference("slug-a"), index)).toMatchObject({
      status: "resolved",
      matchedBy: "slug",
      resolvedTargetPageId: "page-a"
    });
    expect(resolvePageReference(reference("タイトルA"), index)).toMatchObject({
      status: "resolved",
      matchedBy: "title",
      resolvedTargetPageId: "page-a"
    });
  });

  it("stops at the first matching stage", () => {
    expect(resolvePageReference(reference("shared"), index)).toMatchObject({
      matchedBy: "name",
      resolvedTargetPageId: "by-name"
    });
  });

  it("reports ambiguity without falling through to the next stage", () => {
    expect(resolvePageReference(reference("dup-slug"), index)).toMatchObject({
      status: "ambiguous",
      matchedBy: "slug"
    });
    expect(resolvePageReference(reference("重複"), index)).toMatchObject({
      status: "ambiguous",
      matchedBy: "title"
    });
  });

  it("reports a missing page and a missing heading separately", () => {
    expect(resolvePageReference(reference("nowhere"), index)).toMatchObject({
      status: "missing-page"
    });
    expect(resolvePageReference(reference("page-a", "無い見出し"), index))
      .toMatchObject({ status: "missing-heading", resolvedTargetPageId: "page-a" });
  });

  it("matches a heading by its text or its generated id", () => {
    expect(resolvePageReference(reference("page-a", "対象範囲"), index))
      .toMatchObject({ status: "resolved", resolvedTargetHeadingId: "scope" });
    expect(resolvePageReference(reference("page-a", "scope"), index))
      .toMatchObject({ status: "resolved", resolvedTargetHeadingId: "scope" });
  });

  it("matches names case-insensitively but titles case-sensitively", () => {
    expect(resolvePageReference(reference("PAGE-A"), index))
      .toMatchObject({ status: "resolved", matchedBy: "name" });
    expect(resolvePageReference(reference("タイトルa"), index))
      .toMatchObject({ status: "missing-page" });
  });
});

describe("repository-wide resolution and backlinks", () => {
  function page(source: string, relativePath: string): PageEntry {
    const result = extractPageEntry({
      sourcePath: `/project/${relativePath}`,
      relativePath,
      source,
      mtimeMs: 0,
      size: Buffer.byteLength(source)
    });
    if (result.kind !== "entry") throw new Error(`fixture failed: ${relativePath}`);
    return result.entry;
  }

  const target = page(
    `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata: { name: target-page, title: 参照先, slug: target-slug }
spec:
  locale: ja
  blocks:
    - { id: body, type: rich-text, format: commonmark, content: "## 対象範囲\\n\\n本文" }
  translations:
    en:
      visibility: published
      title: Target Page
      blocks:
        - { id: body, type: rich-text, format: commonmark, content: "## Scope\\n\\nBody" }
`,
    "target.yaml"
  );

  const source = page(
    `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata: { name: source-page, title: 参照元 }
spec:
  locale: ja
  blocks:
    - { id: body, type: rich-text, format: commonmark, content: "[[target-page|参照先へ]] と [[target-page#対象範囲]] と [[missing-page]]" }
  translations:
    en:
      visibility: published
      title: Source Page
      blocks:
        - { id: body, type: rich-text, format: commonmark, content: "[[target-slug]]" }
    fr:
      visibility: draft
      title: Source FR
      blocks:
        - { id: body, type: rich-text, format: commonmark, content: "[[target-page]]" }
`,
    "source.yaml"
  );

  const index = deriveRepositoryEntryIndex([target, source]);

  it("resolves by name, slug and heading across the repository", () => {
    const resolved = index.referencesBySource.get("source-page")!;
    expect(
      resolved.map(({ target: value, sourceLocale, status, resolvedTargetPageId }) => ({
        value,
        sourceLocale,
        status,
        resolvedTargetPageId
      }))
    ).toEqual([
      {
        value: "target-page",
        sourceLocale: "",
        status: "resolved",
        resolvedTargetPageId: "target-page"
      },
      {
        value: "target-page",
        sourceLocale: "",
        status: "resolved",
        resolvedTargetPageId: "target-page"
      },
      {
        value: "missing-page",
        sourceLocale: "",
        status: "missing-page",
        resolvedTargetPageId: undefined
      },
      {
        value: "target-slug",
        sourceLocale: "en",
        status: "resolved",
        resolvedTargetPageId: "target-page"
      },
      {
        value: "target-page",
        sourceLocale: "fr",
        status: "resolved",
        resolvedTargetPageId: "target-page"
      }
    ]);
  });

  it("resolves a heading against the source locale's projection", () => {
    const [, headingReference] = index.referencesBySource.get("source-page")!;
    expect(headingReference).toMatchObject({
      status: "resolved",
      resolvedTargetHeadingId: "対象範囲"
    });
  });

  it("reports broken references as warnings without failing the page", () => {
    expect(index.referenceDiagnostics).toEqual([
      {
        code: "BROKEN_PAGE_REFERENCE",
        file: "source.yaml",
        pageId: "source-page",
        locale: "",
        blockId: "body",
        target: "[[missing-page]]",
        message: "参照先Page missing-page が見つかりません"
      }
    ]);
    expect(index.brokenReferences.get("source-page")).toHaveLength(1);
    expect(index.byName.get("source-page")?.readOnly).toBe(false);
  });

  it("excludes draft translations from public backlinks", () => {
    const view = pageRelationsView(index, "target-page", "");
    expect(view.incoming.map(({ pageId, locale }) => ({ pageId, locale }))).toEqual([
      { pageId: "source-page", locale: "" }
    ]);
  });

  it("returns per-locale outgoing references with localized target titles", () => {
    expect(pageRelationsView(index, "source-page", "").outgoing).toEqual([
      {
        pageId: "target-page",
        slug: "target-slug",
        title: "参照先",
        target: "target-page",
        label: "参照先へ",
        blockId: "body",
        locale: "",
        status: "resolved"
      },
      {
        pageId: "target-page",
        slug: "target-slug",
        title: "参照先",
        target: "target-page",
        heading: "対象範囲",
        headingId: "対象範囲",
        blockId: "body",
        locale: "",
        status: "resolved"
      },
      {
        target: "missing-page",
        blockId: "body",
        locale: "",
        status: "missing-page"
      }
    ]);
    expect(pageRelationsView(index, "source-page", "en").outgoing).toEqual([
      {
        pageId: "target-page",
        slug: "target-slug",
        title: "Target Page",
        target: "target-slug",
        blockId: "body",
        locale: "en",
        status: "resolved"
      }
    ]);
  });

  it("keeps name references stable when the target's title and slug change", () => {
    const renamed = page(
      `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata: { name: target-page, title: 新しいタイトル, slug: new-slug }
spec:
  locale: ja
  blocks:
    - { id: body, type: rich-text, format: commonmark, content: "## 対象範囲\\n\\n本文" }
`,
      "moved/target.yaml"
    );
    const next = deriveRepositoryEntryIndex([renamed, source]);
    const view = pageRelationsView(next, "source-page", "");
    expect(view.outgoing[0]).toMatchObject({
      pageId: "target-page",
      slug: "new-slug",
      title: "新しいタイトル",
      status: "resolved"
    });
    expect(
      next.backlinksByTarget.get("target-page")?.map(({ sourcePageId }) => sourcePageId)
    ).toEqual(["source-page", "source-page", "source-page"]);
  });

  it("recomputes backlinks when the source page is removed", () => {
    const without = deriveRepositoryEntryIndex([target]);
    expect(without.backlinksByTarget.get("target-page")).toBeUndefined();
    expect(pageRelationsView(without, "target-page", "").incoming).toEqual([]);
  });

  it("produces identical output for identical input", () => {
    const again = deriveRepositoryEntryIndex([target, source]);
    expect(JSON.stringify(again.referenceDiagnostics))
      .toBe(JSON.stringify(index.referenceDiagnostics));
    expect(
      again.backlinksByTarget.get("target-page")?.map(({ sourceBlockId }) => sourceBlockId)
    ).toEqual(
      index.backlinksByTarget.get("target-page")?.map(({ sourceBlockId }) => sourceBlockId)
    );
  });
});

// tsconfigのnoUncheckedIndexedAccessにより`children[0]`は`RootContent | undefined`
// になる。段落であることを実行時に確かめてから中身を取り出す。
function paragraphNodes(tree: Root): PhrasingContent[] {
  const first = tree.children[0];
  if (first?.type !== "paragraph") {
    throw new Error(`expected a paragraph, got ${first?.type ?? "nothing"}`);
  }
  return first.children;
}

describe("wiki link rendering", () => {
  it("replaces resolved links with link nodes and unresolved ones with spans", () => {
    const tree = fromMarkdown("前 [[known|表示名]] 中 [[unknown]] 後");
    transformWikiLinks(tree, (parts) =>
      parts.target === "known"
        ? {
            status: "resolved",
            href: "/ja/pages/known/",
            title: "既知Page",
            pageId: "known-id"
          }
        : { status: "missing-page" }
    );
    const nodes = paragraphNodes(tree);
    expect(nodes.map((node) => node.type)).toEqual([
      "text",
      "link",
      "text",
      "emphasis",
      "text"
    ]);
    expect(nodes[1]).toMatchObject({
      url: "/ja/pages/known/",
      children: [{ type: "text", value: "表示名" }]
    });
    expect(nodes[3]).toMatchObject({
      children: [{ type: "text", value: "unknown" }]
    });
  });

  it("falls back to the target's current title when no label is given", () => {
    const tree = fromMarkdown("[[known]]");
    transformWikiLinks(tree, () => ({
      status: "resolved",
      href: "/ja/pages/known/",
      title: "現在のタイトル",
      pageId: "known-id"
    }));
    const nodes = paragraphNodes(tree);
    expect(nodes[0]).toMatchObject({
      children: [{ type: "text", value: "現在のタイトル" }]
    });
  });

  it("leaves code and existing links untouched", () => {
    const tree = fromMarkdown("`[[a]]` と [b](https://example.com/)");
    transformWikiLinks(tree, () => ({ status: "resolved", href: "/x/", pageId: "x" }));
    const nodes = paragraphNodes(tree);
    expect(nodes.map((node) => node.type)).toEqual([
      "inlineCode",
      "text",
      "link"
    ]);
  });
});
