import {
  isAlias,
  isNode,
  parseAllDocuments,
  visit,
  type Document
} from "yaml";
import {
  headingId,
  isVellymCandidate,
  knownRichTextBlocks,
  knownRichTextBlocksFrom,
  normalizeLocale,
  validatePage,
  type Diagnostic,
  type Page,
  type PageSummary,
  type RichTextBlock,
  type SearchProjection,
  type SearchResult
} from "@vellym-internal/core";
import { contentHash } from "./path-utils.js";

export interface SearchHeading {
  id: string;
  text: string;
  offset: number;
}

export interface PageLocaleEntry {
  locale?: string;
  rawKey?: string;
  visibility: "draft" | "published";
  title: string;
  normalizedTitle: string;
  normalizedText: string;
  headingData?: Array<number | string>;
}

export interface PageEntry {
  relativePath: string;
  hash: string;
  mtimeMs: number;
  size: number;
  name: string;
  slug: string;
  title: string;
  documentType?: string;
  configuredBaseLocale?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  base: PageLocaleEntry;
  translations?: Map<string, PageLocaleEntry>;
  availableLocales?: string[];
  outgoingPageIds?: string[];
  fileReadOnlyReasons?: string[];
  readOnly: boolean;
  readOnlyReasons?: string[];
  diagnostics?: Diagnostic[];
}

export interface RepositoryEntryIndex {
  pages: PageEntry[];
  byName: Map<string, PageEntry>;
  bySlug: Map<string, PageEntry>;
  backlinks: Map<string, string[]>;
  localizedSummaryCache: Map<string, PageSummary[]>;
  diagnostics: Diagnostic[];
}

export type PageEntryExtraction =
  | { kind: "entry"; entry: PageEntry; diagnostics: Diagnostic[] }
  | { kind: "ignored"; diagnostics: Diagnostic[] }
  | { kind: "invalid"; diagnostics: Diagnostic[] };

export type PageEntryWithPageExtraction =
  | {
      kind: "entry";
      entry: PageEntry;
      page: Page;
      knownBlocks: RichTextBlock[];
      diagnostics: Diagnostic[];
    }
  | { kind: "ignored"; diagnostics: Diagnostic[] }
  | { kind: "invalid"; diagnostics: Diagnostic[] };

export function normalizeSearchText(value: string): string {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  return normalized === value ? value : ownedString(normalized);
}

// yaml and RegExp frequently return sliced strings. Keeping even a tiny slice
// can retain the complete source file in V8, so every scalar that survives in
// the repository index must own its backing storage.
function ownedString(value: string): string {
  return Buffer.from(value).toString("utf8");
}

function ownedRecord(value: Record<string, string> | undefined) {
  if (value === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [ownedString(key), ownedString(item)])
  );
}

function unsafeYamlReasons(
  document: Document.Parsed,
  documentCount: number
): string[] {
  const reasons = new Set<string>();
  if (documentCount !== 1) reasons.add("複数YAML documentを含むため編集できません");
  visit(document, (_key, node) => {
    if (isAlias(node)) reasons.add("aliasを含むため編集できません");
    if (!isNode(node)) return;
    const annotated = node as typeof node & { anchor?: string; tag?: string };
    if (annotated.anchor) reasons.add("anchorを含むため編集できません");
    if (annotated.tag && !annotated.tag.startsWith("tag:yaml.org,2002:")) {
      reasons.add("custom tagを含むため編集できません");
    }
  });
  return [...reasons];
}

function searchableText(
  blocks: ReturnType<typeof knownRichTextBlocks>["blocks"]
): Pick<PageLocaleEntry, "normalizedText" | "headingData"> {
  const texts: string[] = [];
  const headingData: Array<number | string> = [];
  const headingOccurrences = new Map<string, number>();
  let offset = 0;
  for (const block of blocks) {
    let inFence = false;
    for (const sourceLine of block.content.split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(sourceLine)) {
        inFence = !inFence;
        continue;
      }
      const headingMatch = inFence ? undefined : /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(sourceLine);
      let text = (headingMatch?.[1] ?? sourceLine)
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")
        .replace(/^\s*\|?|\|?\s*$/g, "")
        .replace(/[|*_`~]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (/^:?-{3,}:?(?:\s+:?-{3,}:?)*$/.test(text)) text = "";
      if (!text) continue;
      if (headingMatch) {
        const ownedHeading = ownedString(text);
        headingData.push(offset, headingId(ownedHeading, headingOccurrences), ownedHeading);
      }
      texts.push(text);
      offset += text.length + 1;
    }
  }
  const normalizedText = ownedString(texts.join("\n").normalize("NFKC"));
  return {
    normalizedText,
    ...(headingData.length ? { headingData } : {})
  };
}

function pageLinks(records: PageLocaleEntry[]): string[] {
  const ids = new Set<string>();
  const patterns = [
    /\[\[([a-z0-9][a-z0-9-]*)\]\]/gi,
    /(?:[?#&]page=)([a-z0-9][a-z0-9-]*)/gi
  ];
  for (const record of records) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (;;) {
        const match = pattern.exec(record.normalizedText);
        if (!match) break;
        ids.add(match[1]!.toLocaleLowerCase());
      }
    }
  }
  return [...ids];
}

function localeEntry(
  title: string,
  blocks: ReturnType<typeof knownRichTextBlocks>["blocks"],
  options: Pick<PageLocaleEntry, "locale" | "rawKey" | "visibility">
): PageLocaleEntry {
  const ownedTitle = ownedString(title);
  return {
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.rawKey === undefined ? {} : { rawKey: options.rawKey }),
    visibility: options.visibility,
    title: ownedTitle,
    normalizedTitle: normalizeSearchText(ownedTitle),
    ...searchableText(blocks)
  };
}

export function extractPageEntryWithPage(input: {
  sourcePath: string;
  relativePath: string;
  source: string;
  mtimeMs: number;
  size: number;
}): PageEntryWithPageExtraction {
  const diagnostics: Diagnostic[] = [];
  // Source tokens are only needed by the write path. The read index inspects the
  // parsed AST for aliases, anchors, and tags, so retaining CST tokens is wasteful.
  const documents = parseAllDocuments(input.source);
  const first = documents[0];
  if (!first) return { kind: "ignored", diagnostics };
  if (first.errors.length) {
    diagnostics.push(...first.errors.map((error) => ({
      file: input.relativePath,
      severity: "error" as const,
      code: "YAML_PARSE",
      message: error.message
    })));
    return { kind: "invalid", diagnostics };
  }
  let value: unknown;
  try {
    value = first.toJS({ maxAliasCount: 100 });
  } catch (error) {
    diagnostics.push({
      file: input.relativePath,
      severity: "error",
      code: "YAML_CONVERSION",
      message: error instanceof Error ? error.message : String(error)
    });
    return { kind: "invalid", diagnostics };
  }
  if (!isVellymCandidate(value)) return { kind: "ignored", diagnostics };

  const validation = validatePage(value, input.relativePath);
  diagnostics.push(...validation.diagnostics);
  if (!validation.page) return { kind: "invalid", diagnostics };
  const page = validation.page;
  const known = knownRichTextBlocks(page, input.relativePath);
  diagnostics.push(...known.diagnostics);
  const reasons = unsafeYamlReasons(first, documents.length);

  const baseLocale = page.spec.locale === undefined
    ? undefined
    : ownedString(normalizeLocale(page.spec.locale).canonical!);
  const base = localeEntry(page.metadata.title, known.blocks, {
    visibility: "published"
  });
  const translations = new Map<string, PageLocaleEntry>();
  for (const translation of validation.translations) {
    const blocks = knownRichTextBlocksFrom(
      translation.value.blocks,
      input.relativePath,
      `/spec/translations/${translation.rawKey}/blocks`
    );
    diagnostics.push(...blocks.diagnostics);
    const locale = ownedString(translation.locale);
    const entry = localeEntry(
      translation.value.title,
      blocks.blocks,
      {
        locale,
        rawKey: ownedString(translation.rawKey),
        visibility: translation.value.visibility ?? "published"
      }
    );
    translations.set(entry.locale!, entry);
  }
  const searchableRecords = [base, ...translations.values()];
  const availableLocales = [...translations.values()]
    .filter((item) => item.visibility === "published")
    .map((item) => item.locale!);
  const outgoingPageIds = pageLinks(searchableRecords);
  const name = ownedString(page.metadata.name);
  const slug = page.metadata.slug === undefined || page.metadata.slug === page.metadata.name
    ? name
    : ownedString(page.metadata.slug);
  return {
    kind: "entry",
    diagnostics,
    page,
    knownBlocks: known.blocks,
    entry: {
      relativePath: input.relativePath.replaceAll("\\", "/"),
      hash: contentHash(input.source),
      mtimeMs: input.mtimeMs,
      size: input.size,
      name,
      slug,
      title: base.title,
      ...(page.spec.documentType === undefined
        ? {}
        : { documentType: ownedString(page.spec.documentType) }),
      ...(baseLocale === undefined ? {} : { configuredBaseLocale: baseLocale }),
      ...(page.metadata.labels === undefined ? {} : { labels: ownedRecord(page.metadata.labels) }),
      ...(page.metadata.annotations === undefined
        ? {}
        : { annotations: ownedRecord(page.metadata.annotations) }),
      base,
      ...(translations.size ? { translations } : {}),
      ...(availableLocales.length ? { availableLocales } : {}),
      ...(outgoingPageIds.length ? { outgoingPageIds } : {}),
      ...(reasons.length ? { fileReadOnlyReasons: reasons } : {}),
      readOnly: reasons.length > 0,
      ...(reasons.length ? { readOnlyReasons: reasons } : {}),
      ...(diagnostics.length ? { diagnostics } : {})
    }
  };
}

export function extractPageEntry(
  input: Parameters<typeof extractPageEntryWithPage>[0]
): PageEntryExtraction {
  const result = extractPageEntryWithPage(input);
  if (result.kind !== "entry") return result;
  return { kind: "entry", entry: result.entry, diagnostics: result.diagnostics };
}

export function pageEntryPageMetadata(entry: PageEntry): Page["metadata"] {
  return {
    name: entry.name,
    title: entry.title,
    ...(entry.slug === entry.name ? {} : { slug: entry.slug }),
    ...(entry.labels === undefined ? {} : { labels: entry.labels }),
    ...(entry.annotations === undefined ? {} : { annotations: entry.annotations })
  };
}

function duplicateDiagnostic(
  entry: PageEntry,
  path: string,
  code: string,
  message: string
): Diagnostic {
  return {
    file: entry.relativePath,
    path,
    severity: "error",
    code,
    message
  };
}

/**
 * Derives repository-wide state without file I/O. Entries remain independently
 * replaceable; duplicate/read-only state is applied to fresh entry objects.
 */
export function deriveRepositoryEntryIndex(
  sourceEntries: readonly PageEntry[]
): RepositoryEntryIndex {
  const pages = sourceEntries.map((entry) => {
    const reasons = [...(entry.fileReadOnlyReasons ?? [])];
    return {
      ...entry,
      readOnly: reasons.length > 0,
      ...(reasons.length ? { readOnlyReasons: reasons } : { readOnlyReasons: undefined })
    };
  })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const diagnostics: Diagnostic[] = [];
  const nameGroups = new Map<string, PageEntry[]>();
  for (const entry of pages) {
    const group = nameGroups.get(entry.name) ?? [];
    group.push(entry);
    nameGroups.set(entry.name, group);
  }
  const uniquePages: PageEntry[] = [];
  for (const [name, group] of nameGroups) {
    if (group.length > 1) {
      const message = `Page ID ${name} が重複しています`;
      for (const entry of group) {
        entry.readOnly = true;
        const reasons = (entry.readOnlyReasons ??= []);
        if (!reasons.includes(message)) reasons.push(message);
        diagnostics.push(duplicateDiagnostic(
          entry,
          "/metadata/name",
          "DUPLICATE_PAGE_ID",
          message
        ));
      }
    }
    uniquePages.push(group[0]!);
  }

  const slugGroups = new Map<string, PageEntry[]>();
  for (const entry of uniquePages) {
    const slug = entry.slug.normalize("NFC").toLocaleLowerCase();
    const group = slugGroups.get(slug) ?? [];
    group.push(entry);
    slugGroups.set(slug, group);
  }
  for (const [slug, group] of slugGroups) {
    if (group.length < 2) continue;
    const message = `URL名 ${slug} が重複しています`;
    for (const entry of group) {
      entry.readOnly = true;
        const reasons = (entry.readOnlyReasons ??= []);
        if (!reasons.includes(message)) reasons.push(message);
      diagnostics.push(duplicateDiagnostic(
        entry,
        "/metadata/slug",
        "DUPLICATE_PAGE_SLUG",
        message
      ));
    }
  }

  const byName = new Map(uniquePages.map((entry) => [entry.name, entry]));
  const bySlug = new Map(
    uniquePages.map((entry) => [
      entry.slug.normalize("NFC").toLocaleLowerCase(),
      entry
    ])
  );
  const backlinkSets = new Map<string, Set<string>>();
  for (const entry of uniquePages) {
    for (const target of entry.outgoingPageIds ?? []) {
      const links = backlinkSets.get(target) ?? new Set<string>();
      links.add(entry.name);
      backlinkSets.set(target, links);
    }
  }
  const backlinks = new Map(
    [...backlinkSets].map(([target, sources]) => [target, [...sources].sort()])
  );
  return {
    pages: uniquePages,
    byName,
    bySlug,
    backlinks,
    localizedSummaryCache: new Map(),
    diagnostics
  };
}

function breadcrumbs(relativePath: string): string[] {
  return relativePath.split("/").filter(Boolean).slice(0, -1);
}

function snippet(record: PageLocaleEntry, index: number, queryLength: number): string {
  const start = Math.max(0, index - 42);
  const end = Math.min(record.normalizedText.length, index + queryLength + 72);
  return `${start > 0 ? "…" : ""}${record.normalizedText.slice(start, end)}${
    end < record.normalizedText.length ? "…" : ""
  }`;
}

function headingAt(record: PageLocaleEntry, offset: number): SearchHeading | undefined {
  let found: SearchHeading | undefined;
  const data = record.headingData ?? [];
  for (let index = 0; index < data.length; index += 3) {
    const headingOffset = data[index] as number;
    if (headingOffset > offset) break;
    found = {
      offset: headingOffset,
      id: data[index + 1] as string,
      text: data[index + 2] as string
    };
  }
  return found;
}

function localeRecord(
  entry: PageEntry,
  locale: string | undefined,
  defaultLocale: string | undefined
): PageLocaleEntry {
  if (!locale || !defaultLocale || locale === defaultLocale) return entry.base;
  const translation = entry.translations?.get(locale);
  return translation?.visibility === "published" ? translation : entry.base;
}

export function searchRepositoryEntries(
  index: RepositoryEntryIndex,
  rawQuery: string,
  options: { locale?: string; defaultLocale?: string; limit?: number } = {}
): SearchProjection {
  const query = rawQuery.trim();
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return { query, indexedPages: index.pages.length, total: 0, results: [] };
  }
  const titleMatches: SearchResult[] = [];
  const headingMatches: SearchResult[] = [];
  const bodyMatches: SearchResult[] = [];
  const limit = options.limit ?? 50;
  let total = 0;
  const queryPattern = new RegExp(
    normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu"
  );
  index.pages.forEach((entry) => {
    const record = localeRecord(entry, options.locale, options.defaultLocale);
    let hitOrder = 0;
    if (record.normalizedTitle.includes(normalizedQuery)) {
      total += 1;
      if (titleMatches.length < limit) titleMatches.push({
        resultId: `${entry.name}:title`,
        pageId: entry.name,
        title: record.title,
        breadcrumbs: breadcrumbs(entry.relativePath),
        snippet: record.title
      });
      hitOrder += 1;
    }
    queryPattern.lastIndex = 0;
    for (;;) {
      const occurrence = queryPattern.exec(record.normalizedText);
      if (!occurrence) break;
      const match = occurrence.index;
      total += 1;
      const heading = headingAt(record, match);
      const lineStart = record.normalizedText.lastIndexOf("\n", match - 1) + 1;
      const lineEndValue = record.normalizedText.indexOf("\n", match);
      const lineEnd = lineEndValue < 0 ? record.normalizedText.length : lineEndValue;
      const isHeading = Boolean(
        heading && heading.offset === lineStart && lineEnd - lineStart === heading.text.length
      );
      const bucket = isHeading ? headingMatches : bodyMatches;
      if (bucket.length < limit) bucket.push({
        resultId: `${entry.name}:hit:${hitOrder}`,
        pageId: entry.name,
        title: record.title,
        breadcrumbs: breadcrumbs(entry.relativePath),
        ...(heading ? { heading: { id: heading.id, text: heading.text } } : {}),
        snippet: snippet(record, match, normalizedQuery.length)
      });
      hitOrder += 1;
    }
  });
  const results = [...titleMatches, ...headingMatches, ...bodyMatches].slice(0, limit);
  return {
    query,
    indexedPages: index.pages.length,
    total,
    results
  };
}
