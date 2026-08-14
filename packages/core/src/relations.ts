import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes, Parent, Root, Text } from "mdast";
import { headingId, type DocumentHeading } from "./navigation.js";
import type { RichTextBlock } from "./types.js";

// Vellymの内部Pageリンクは Obsidian互換の wiki link `[[...]]` だけとする。
// 外部URL・mailto・相対path・画像は通常のCommonMarkリンクのままであり、
// ここでは一切扱わない。`[[...]]`＝内部リンク、`[]()`＝内部リンク以外、という
// 一対一の対応にすることで、抽出・描画・静的出力・診断の分岐を最小化する。

export interface WikiLinkParts {
  /** 参照先Pageを指す文字列。metadata.name / slug / title のいずれか。 */
  target: string;
  /** `#`以降。heading textでもheading IDでも一致させる。 */
  heading?: string;
  /** `|`以降。省略時は参照先の現在のtitleを描画する。 */
  label?: string;
}

export interface WikiLinkMatch extends WikiLinkParts {
  /** `[[` の開始位置。 */
  start: number;
  /** `]]` の直後の位置。 */
  end: number;
  raw: string;
}

// bodyに `[` `]` を許すと入れ子や未閉じで曖昧になるため、最短一致で閉じる。
const WIKI_LINK_PATTERN = /\[\[([^[\]]*)\]\]/g;

/**
 * `[[...]]` の内側を分解する。区切りは最初の`|`（label）と、その手前の最初の`#`
 * （heading）。targetが空になるもの（`[[]]`, `[[#h]]`, `[[|l]]`）はリンクとして
 * 扱わず、本文の文字列のまま残す。
 */
export function parseWikiLinkBody(body: string): WikiLinkParts | undefined {
  const pipeIndex = body.indexOf("|");
  const beforeLabel = pipeIndex < 0 ? body : body.slice(0, pipeIndex);
  const rawLabel = pipeIndex < 0 ? undefined : body.slice(pipeIndex + 1).trim();
  const hashIndex = beforeLabel.indexOf("#");
  const target = (hashIndex < 0 ? beforeLabel : beforeLabel.slice(0, hashIndex)).trim();
  const rawHeading = hashIndex < 0 ? undefined : beforeLabel.slice(hashIndex + 1).trim();
  if (!target) return undefined;
  return {
    target,
    ...(rawHeading ? { heading: rawHeading } : {}),
    ...(rawLabel ? { label: rawLabel } : {})
  };
}

/** 素のテキストから `[[...]]` を位置つきで列挙する。 */
export function scanWikiLinks(text: string): WikiLinkMatch[] {
  const matches: WikiLinkMatch[] = [];
  WIKI_LINK_PATTERN.lastIndex = 0;
  for (;;) {
    const match = WIKI_LINK_PATTERN.exec(text);
    if (!match) break;
    const parts = parseWikiLinkBody(match[1]!);
    if (!parts) continue;
    matches.push({
      ...parts,
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0]
    });
  }
  return matches;
}

export function formatWikiLink(parts: WikiLinkParts): string {
  const heading = parts.heading ? `#${parts.heading}` : "";
  const label = parts.label ? `|${parts.label}` : "";
  return `[[${parts.target}${heading}${label}]]`;
}

// 構文木上でwiki linkを解釈しないnode。code fence・inline codeの中身、既存の
// link/image、生HTMLは参照として扱わない。
const OPAQUE_NODE_TYPES = new Set<Nodes["type"]>([
  "code",
  "inlineCode",
  "html",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
  "yaml"
]);

function visitTextNodes(
  node: Nodes,
  parent: Parent | undefined,
  visitor: (text: Text, parent: Parent) => void
): void {
  if (OPAQUE_NODE_TYPES.has(node.type)) return;
  if (node.type === "text") {
    if (parent) visitor(node, parent);
    return;
  }
  if (!("children" in node) || !Array.isArray(node.children)) return;
  for (const child of [...(node.children as Nodes[])]) {
    visitTextNodes(child, node as Parent, visitor);
  }
}

export interface ExtractedWikiLink extends WikiLinkParts {
  blockId: string;
}

/**
 * CommonMark構文木のtext nodeだけを走査してwiki linkを抽出する。
 * 全文検索用の正規化テキストは参照抽出に使わない（正規化がリンクURLを壊すため）。
 */
export function extractWikiLinks(
  blocks: readonly RichTextBlock[]
): ExtractedWikiLink[] {
  const links: ExtractedWikiLink[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    visitTextNodes(fromMarkdown(block.content), undefined, (text) => {
      for (const match of scanWikiLinks(text.value)) {
        const key = `${block.id}\u0000${match.target}\u0000${match.heading ?? ""}\u0000${match.label ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({
          blockId: block.id,
          target: match.target,
          ...(match.heading === undefined ? {} : { heading: match.heading }),
          ...(match.label === undefined ? {} : { label: match.label })
        });
      }
    });
  }
  return links;
}

export interface InternalPageReference {
  sourcePageId: string;
  sourceLocale: string;
  sourceBlockId: string;
  target: string;
  targetHeading?: string;
  label?: string;
}

export type PageReferenceStatus =
  | "resolved"
  | "missing-page"
  | "missing-heading"
  | "ambiguous";

export type PageReferenceMatch = "name" | "slug" | "title";

export interface ResolvedPageReference extends InternalPageReference {
  status: PageReferenceStatus;
  matchedBy?: PageReferenceMatch;
  resolvedTargetPageId?: string;
  resolvedTargetHeadingId?: string;
}

export type PageReferenceDiagnosticCode =
  | "BROKEN_PAGE_REFERENCE"
  | "BROKEN_HEADING_REFERENCE"
  | "AMBIGUOUS_PAGE_REFERENCE";

export interface PageReferenceDiagnostic {
  code: PageReferenceDiagnosticCode;
  file: string;
  pageId: string;
  locale: string;
  blockId: string;
  target: string;
  message: string;
}

export interface PageReferenceView {
  /** 相手側Pageのmetadata.name。未解決のときは無い。 */
  pageId?: string;
  slug?: string;
  title?: string;
  /** 本文に書かれた生のtarget文字列。リンク切れ表示に使う。 */
  target: string;
  label?: string;
  heading?: string;
  headingId?: string;
  blockId: string;
  locale: string;
  status: PageReferenceStatus;
}

export interface PageRelationsView {
  outgoing: PageReferenceView[];
  incoming: PageReferenceView[];
  diagnostics: PageReferenceDiagnostic[];
}

/**
 * 解決に必要な索引。runtime-nodeとstatic builderの双方が同じ規則を使えるよう、
 * 検索の実体はcore側に置き、Pageの持ち方だけを呼び出し側に委ねる。
 */
export interface PageReferenceIndex {
  /** NFKC + 小文字化した metadata.name → Page ID */
  byName: ReadonlyMap<string, readonly string[]>;
  /** NFKC + 小文字化した metadata.slug → Page ID */
  bySlug: ReadonlyMap<string, readonly string[]>;
  /** NFKC の title（base + 公開済み翻訳）→ Page ID */
  byTitle: ReadonlyMap<string, readonly string[]>;
  headings(pageId: string, locale: string): readonly ReferenceHeading[] | undefined;
}

export type ReferenceHeading = Pick<DocumentHeading, "id" | "text">;

export function referenceKey(value: string, caseSensitive: boolean): string {
  const normalized = value.normalize("NFKC").trim();
  return caseSensitive ? normalized : normalized.toLocaleLowerCase();
}

const MATCH_ORDER: readonly PageReferenceMatch[] = ["name", "slug", "title"];

function candidatesFor(
  index: PageReferenceIndex,
  stage: PageReferenceMatch,
  target: string
): readonly string[] | undefined {
  if (stage === "name") return index.byName.get(referenceKey(target, false));
  if (stage === "slug") return index.bySlug.get(referenceKey(target, false));
  return index.byTitle.get(referenceKey(target, true));
}

function matchHeading(
  headings: readonly ReferenceHeading[],
  requested: string
): ReferenceHeading | undefined {
  const wanted = requested.normalize("NFKC").trim();
  const wantedId = headingId(wanted, new Map());
  const wantedLower = wanted.toLocaleLowerCase();
  return headings.find((heading) =>
    heading.id === wanted ||
    heading.id === wantedId ||
    heading.text.normalize("NFKC").trim() === wanted ||
    heading.text.normalize("NFKC").trim().toLocaleLowerCase() === wantedLower
  );
}

/**
 * `metadata.name` → `metadata.slug` → title完全一致 の順に照合する。ある段階で
 * 複数Pageへ一致した場合は次の段階へ進まず`ambiguous`とする。利用者はtitleを
 * 変更するか`metadata.name`で参照し直すことで解消できる。
 */
export function resolvePageReference(
  reference: InternalPageReference,
  index: PageReferenceIndex
): ResolvedPageReference {
  for (const stage of MATCH_ORDER) {
    const candidates = candidatesFor(index, stage, reference.target);
    if (!candidates || candidates.length === 0) continue;
    if (candidates.length > 1) {
      return { ...reference, status: "ambiguous", matchedBy: stage };
    }
    const pageId = candidates[0]!;
    if (reference.targetHeading === undefined) {
      return {
        ...reference,
        status: "resolved",
        matchedBy: stage,
        resolvedTargetPageId: pageId
      };
    }
    const headings = index.headings(pageId, reference.sourceLocale) ?? [];
    const heading = matchHeading(headings, reference.targetHeading);
    if (!heading) {
      return {
        ...reference,
        status: "missing-heading",
        matchedBy: stage,
        resolvedTargetPageId: pageId
      };
    }
    return {
      ...reference,
      status: "resolved",
      matchedBy: stage,
      resolvedTargetPageId: pageId,
      resolvedTargetHeadingId: heading.id
    };
  }
  return { ...reference, status: "missing-page" };
}

export function pageReferenceDiagnostic(
  reference: ResolvedPageReference,
  file: string
): PageReferenceDiagnostic | undefined {
  const shared = {
    file,
    pageId: reference.sourcePageId,
    locale: reference.sourceLocale,
    blockId: reference.sourceBlockId,
    target: formatWikiLink({
      target: reference.target,
      ...(reference.targetHeading === undefined ? {} : { heading: reference.targetHeading }),
      ...(reference.label === undefined ? {} : { label: reference.label })
    })
  };
  if (reference.status === "missing-page") {
    return {
      ...shared,
      code: "BROKEN_PAGE_REFERENCE",
      message: `参照先Page ${reference.target} が見つかりません`
    };
  }
  if (reference.status === "missing-heading") {
    return {
      ...shared,
      code: "BROKEN_HEADING_REFERENCE",
      message: `参照先Page ${reference.target} に見出し ${reference.targetHeading} がありません`
    };
  }
  if (reference.status === "ambiguous") {
    return {
      ...shared,
      code: "AMBIGUOUS_PAGE_REFERENCE",
      message: `${reference.target} は複数のPageに一致します。参照先を metadata.name で指定するか、titleを変更してください`
    };
  }
  return undefined;
}

export interface WikiLinkResolution {
  /** 遷移先。未解決のときは省略し、リンクではなくリンク切れ表示にする。 */
  href?: string;
  /** labelが無いときに描画する文言。 */
  title?: string;
  /** 解決済みの参照先metadata.name。クリック時の遷移に使う。 */
  pageId?: string;
  /** 解決済みのheading ID。 */
  headingId?: string;
  status: PageReferenceStatus;
}

function brokenLinkTitle(
  parts: WikiLinkParts,
  status: PageReferenceStatus
): string {
  if (status === "missing-heading") {
    return `参照先Page ${parts.target} に見出し ${parts.heading} がありません`;
  }
  if (status === "ambiguous") {
    return `${parts.target} は複数のPageに一致します`;
  }
  return `参照先Page ${parts.target} が見つかりません`;
}

/**
 * mdast上の`[[...]]`を、解決結果に応じてlink node（またはリンク切れ表示）へ
 * 置き換える。readerとstatic builderが同じ描画規則を共有するためにcoreへ置く。
 */
export function transformWikiLinks(
  tree: Root,
  resolve: (parts: WikiLinkParts) => WikiLinkResolution
): void {
  const replacements: Array<{ parent: Parent; node: Text; nodes: Nodes[] }> = [];
  visitTextNodes(tree, undefined, (node, parent) => {
    const matches = scanWikiLinks(node.value);
    if (matches.length === 0) return;
    const nodes: Nodes[] = [];
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) {
        nodes.push({ type: "text", value: node.value.slice(cursor, match.start) });
      }
      const resolution = resolve(match);
      const text = match.label ?? resolution.title ?? match.target;
      if (resolution.status === "resolved" && resolution.href) {
        nodes.push({
          type: "link",
          url: resolution.href,
          children: [{ type: "text", value: text }],
          data: {
            hProperties: {
              className: ["internal-link"],
              "data-page-reference": match.target,
              ...(resolution.pageId === undefined ? {} : { "data-page-id": resolution.pageId }),
              ...(resolution.headingId === undefined
                ? {}
                : { "data-heading-id": resolution.headingId })
            }
          }
        } as Nodes);
      } else {
        nodes.push({
          type: "emphasis",
          children: [{ type: "text", value: text }],
          data: {
            hName: "span",
            hProperties: {
              className: ["broken-link"],
              "data-page-reference": match.target,
              "data-reference-status": resolution.status,
              title: brokenLinkTitle(match, resolution.status)
            }
          }
        } as Nodes);
      }
      cursor = match.end;
    }
    if (cursor < node.value.length) {
      nodes.push({ type: "text", value: node.value.slice(cursor) });
    }
    replacements.push({ parent, node, nodes });
  });
  for (const { parent, node, nodes } of replacements) {
    const index = parent.children.indexOf(node as never);
    if (index < 0) continue;
    parent.children.splice(index, 1, ...(nodes as never[]));
  }
}
