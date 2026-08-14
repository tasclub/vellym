import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { PageView } from "./types.js";
import { headingId } from "./navigation.js";

export interface SearchResult {
  resultId: string;
  pageId: string;
  title: string;
  breadcrumbs: string[];
  heading?: { id: string; text: string };
  snippet: string;
}

export interface SearchProjection {
  query: string;
  indexedPages: number;
  total: number;
  results: SearchResult[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function snippet(value: string, query: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const index = normalize(compact).indexOf(query);
  if (index < 0) return compact.slice(0, 120);
  const start = Math.max(0, index - 42);
  const end = Math.min(compact.length, index + query.length + 72);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function breadcrumbs(relativePath: string): string[] {
  return relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .slice(0, -1);
}

export function searchPages(
  views: PageView[],
  rawQuery: string,
  limit = 50
): SearchProjection {
  const query = rawQuery.trim();
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return { query, indexedPages: views.length, total: 0, results: [] };
  }

  const matches: Array<SearchResult & { score: number; order: number }> = [];
  views.forEach((view, order) => {
    const title = view.page.metadata.title;
    let best:
      | { score: number; text: string; heading?: { id: string; text: string } }
      | undefined;
    if (normalize(title).includes(normalizedQuery)) {
      best = { score: 3, text: title };
    }

    const occurrences = new Map<string, number>();
    for (const block of view.knownBlocks) {
      const tree = fromMarkdown(block.content);
      let currentHeading: { id: string; text: string } | undefined;
      for (const node of tree.children) {
        const text = toString(node).trim();
        if (node.type === "heading") {
          currentHeading = {
            id: headingId(text, occurrences),
            text
          };
        }
        if (!text || !normalize(text).includes(normalizedQuery)) continue;
        const score =
          node.type === "heading"
            ? 2
            : 1;
        if (!best || score > best.score) {
          best = { score, text, heading: currentHeading };
        }
      }
    }
    if (!best) return;
    matches.push({
      resultId: `${view.page.metadata.name}:0`,
      pageId: view.page.metadata.name,
      title,
      breadcrumbs: breadcrumbs(view.relativePath),
      ...(best.heading ? { heading: best.heading } : {}),
      snippet: snippet(best.text, normalizedQuery),
      score: best.score,
      order
    });
  });

  matches.sort((left, right) => right.score - left.score || left.order - right.order);
  const results = matches.slice(0, limit).map(({ score: _score, order: _order, ...result }) => result);
  return {
    query,
    indexedPages: views.length,
    total: matches.length,
    results
  };
}
