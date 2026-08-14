import {
  isAlias,
  isNode,
  parseAllDocuments,
  visit,
  type Document
} from "yaml";
import {
  extractWikiLinks,
  headingId,
  isUnknownKind,
  isVellymCandidate,
  knownRichTextBlocks,
  knownRichTextBlocksFrom,
  normalizeLocale,
  pageReferenceDiagnostic,
  referenceKey,
  resolvePageReference,
  validatePage,
  validateResource,
  type Diagnostic,
  type InternalPageReference,
  type Page,
  type PageReferenceDiagnostic,
  type PageReferenceIndex,
  type PageReferenceView,
  type PageRelationsView,
  type PageSummary,
  type ReferenceHeading,
  type ResolvedPageReference,
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
  /** リソース種別。Coreが解釈できないkindは文書ツリーへ出さない。 */
  kind: string;
  relativePath: string;
  hash: string;
  mtimeMs: number;
  size: number;
  name: string;
  slug: string;
  title: string;
  configuredBaseLocale?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  base: PageLocaleEntry;
  translations?: Map<string, PageLocaleEntry>;
  availableLocales?: string[];
  /**
   * 本文の`[[...]]`から抽出した未解決の発リンク。解決はrepository全件を読み終えた
   * 後の横断パス（deriveRepositoryEntryIndex）で行う。
   */
  outgoingReferences?: InternalPageReference[];
  fileReadOnlyReasons?: string[];
  readOnly: boolean;
  readOnlyReasons?: string[];
  diagnostics?: Diagnostic[];
}

/** base projectionを指すlocale key。PageLocaleEntry.locale === undefined に対応する。 */
export const BASE_LOCALE_KEY = "";

export interface RepositoryEntryIndex {
  pages: PageEntry[];
  byName: Map<string, PageEntry>;
  bySlug: Map<string, PageEntry>;
  /** source Page ID → そのPageが持つ解決済み参照 */
  referencesBySource: Map<string, ResolvedPageReference[]>;
  /** target Page ID → そのPageを参照している解決済み参照 */
  backlinksByTarget: Map<string, ResolvedPageReference[]>;
  /** source Page ID → 未解決・曖昧な参照 */
  brokenReferences: Map<string, ResolvedPageReference[]>;
  referenceDiagnostics: PageReferenceDiagnostic[];
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

/**
 * CommonMark構文木から発リンクを抽出する。検索用`normalizedText`はMarkdownリンクの
 * URLを捨てるため参照抽出には使えず、code fence/inline codeの除外も正規表現では
 * 保証できない。両者は結合させない。
 */
function outgoingReferences(
  sourcePageId: string,
  sourceLocale: string,
  blocks: readonly RichTextBlock[]
): InternalPageReference[] {
  return extractWikiLinks(blocks).map((link) => ({
    sourcePageId,
    sourceLocale,
    sourceBlockId: ownedString(link.blockId),
    target: ownedString(link.target),
    ...(link.heading === undefined ? {} : { targetHeading: ownedString(link.heading) }),
    ...(link.label === undefined ? {} : { label: ownedString(link.label) })
  }));
}

/** 検索用に平坦化した見出し列を、参照解決が使える形へ戻す。 */
export function localeHeadings(record: PageLocaleEntry): ReferenceHeading[] {
  const data = record.headingData ?? [];
  const headings: ReferenceHeading[] = [];
  for (let index = 0; index + 2 < data.length + 1; index += 3) {
    const id = data[index + 1];
    const text = data[index + 2];
    if (typeof id === "string" && typeof text === "string") headings.push({ id, text });
  }
  return headings;
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

  // Coreが種別固有スキーマを持たないkindは、Pageスキーマで検証しない。共通契約の
  // 範囲だけを解釈し、種別固有のspecは解釈せず原文のまま保持する。解釈できない
  // ことをerrorにせず、repositoryの読み込みもbuildも失敗させない。
  const unknownKind = isUnknownKind(value);
  const validation = unknownKind
    ? validateResource(value, input.relativePath)
    : validatePage(value, input.relativePath);
  diagnostics.push(...validation.diagnostics);
  const validated = unknownKind
    ? (validation as ReturnType<typeof validateResource>).resource
    : (validation as ReturnType<typeof validatePage>).page;
  if (!validated) return { kind: "invalid", diagnostics };
  if (unknownKind) {
    diagnostics.push({
      file: input.relativePath,
      path: "/kind",
      severity: "warning",
      code: "UNKNOWN_RESOURCE_KIND",
      message: `kind ${validated.kind} を解釈できるプラグインがありません。本文だけを読み取ります`
    });
  }
  const page = validated as Page;
  const known = knownRichTextBlocks(page, input.relativePath);
  diagnostics.push(...known.diagnostics);
  const reasons = unsafeYamlReasons(first, documents.length);

  const name = ownedString(page.metadata.name);
  const baseLocale = page.spec.locale === undefined
    ? undefined
    : ownedString(normalizeLocale(page.spec.locale).canonical!);
  const base = localeEntry(page.metadata.title, known.blocks, {
    visibility: "published"
  });
  const references = outgoingReferences(name, BASE_LOCALE_KEY, known.blocks);
  const translations = new Map<string, PageLocaleEntry>();
  for (const translation of validation.translations) {
    const blocks = knownRichTextBlocksFrom(
      translation.value.blocks ?? [],
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
    references.push(...outgoingReferences(name, locale, blocks.blocks));
    translations.set(entry.locale!, entry);
  }
  const availableLocales = [...translations.values()]
    .filter((item) => item.visibility === "published")
    .map((item) => item.locale!);
  const slug = page.metadata.slug === undefined || page.metadata.slug === page.metadata.name
    ? name
    : ownedString(page.metadata.slug);
  return {
    kind: "entry",
    diagnostics,
    page,
    knownBlocks: known.blocks,
    entry: {
      kind: ownedString(validated.kind),
      relativePath: input.relativePath.replaceAll("\\", "/"),
      hash: contentHash(input.source),
      mtimeMs: input.mtimeMs,
      size: input.size,
      name,
      slug,
      title: base.title,
      ...(baseLocale === undefined ? {} : { configuredBaseLocale: baseLocale }),
      ...(page.metadata.labels === undefined ? {} : { labels: ownedRecord(page.metadata.labels) }),
      ...(page.metadata.annotations === undefined
        ? {}
        : { annotations: ownedRecord(page.metadata.annotations) }),
      base,
      ...(translations.size ? { translations } : {}),
      ...(availableLocales.length ? { availableLocales } : {}),
      ...(references.length ? { outgoingReferences: references } : {}),
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
  const {
    referencesBySource,
    backlinksByTarget,
    brokenReferences,
    referenceDiagnostics
  } = resolveEntryReferences(uniquePages, byName);

  return {
    pages: uniquePages,
    byName,
    bySlug,
    referencesBySource,
    backlinksByTarget,
    brokenReferences,
    referenceDiagnostics,
    localizedSummaryCache: new Map(),
    diagnostics
  };
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * repository全件が揃った後に発リンクを解決し、逆参照と診断を反転生成する。
 * ファイルI/Oを伴わないため全件を対象にしても安価である。
 */
function resolveEntryReferences(
  pages: readonly PageEntry[],
  byName: ReadonlyMap<string, PageEntry>
): Pick<
  RepositoryEntryIndex,
  "referencesBySource" | "backlinksByTarget" | "brokenReferences" | "referenceDiagnostics"
> {
  const nameIndex = new Map<string, string[]>();
  const slugIndex = new Map<string, string[]>();
  const titleIndex = new Map<string, string[]>();
  for (const entry of pages) {
    pushInto(nameIndex, referenceKey(entry.name, false), entry.name);
    pushInto(slugIndex, referenceKey(entry.slug, false), entry.name);
    // titleはbaseと公開済み翻訳の双方を対象にする。localeをまたいだ重複は
    // ambiguousとして診断し、自動的な優先順位付けはしない。
    const titles = new Set([
      entry.base.title,
      ...[...(entry.translations?.values() ?? [])]
        .filter((item) => item.visibility === "published")
        .map((item) => item.title)
    ]);
    for (const title of titles) pushInto(titleIndex, referenceKey(title, true), entry.name);
  }

  const headingCache = new Map<string, ReferenceHeading[]>();
  const index: PageReferenceIndex = {
    byName: nameIndex,
    bySlug: slugIndex,
    byTitle: titleIndex,
    headings(pageId, locale) {
      const cacheKey = `${pageId}\u0000${locale}`;
      const cached = headingCache.get(cacheKey);
      if (cached) return cached;
      const entry = byName.get(pageId);
      if (!entry) return undefined;
      // 参照元のlocaleに公開済み翻訳があればそれを、無ければbaseを見る。
      const translation = locale === BASE_LOCALE_KEY
        ? undefined
        : entry.translations?.get(locale);
      const record = translation?.visibility === "published" ? translation : entry.base;
      const headings = localeHeadings(record);
      headingCache.set(cacheKey, headings);
      return headings;
    }
  };

  const referencesBySource = new Map<string, ResolvedPageReference[]>();
  const backlinksByTarget = new Map<string, ResolvedPageReference[]>();
  const brokenReferences = new Map<string, ResolvedPageReference[]>();
  const referenceDiagnostics: PageReferenceDiagnostic[] = [];
  // pagesはrelativePath順に整列済み。ここで追記順を保つことで、同じ入力から
  // 同じ出力を返す。
  for (const entry of pages) {
    for (const reference of entry.outgoingReferences ?? []) {
      const resolved = resolvePageReference(reference, index);
      pushInto(referencesBySource, entry.name, resolved);
      if (resolved.status === "resolved" && resolved.resolvedTargetPageId) {
        pushInto(backlinksByTarget, resolved.resolvedTargetPageId, resolved);
      } else {
        pushInto(brokenReferences, entry.name, resolved);
      }
      const diagnostic = pageReferenceDiagnostic(resolved, entry.relativePath);
      if (diagnostic) referenceDiagnostics.push(diagnostic);
    }
  }
  return {
    referencesBySource,
    backlinksByTarget,
    brokenReferences,
    referenceDiagnostics
  };
}

/** localeで公開されている表示title。無ければbase titleへfallbackする。 */
function displayTitle(entry: PageEntry, locale: string): string {
  if (locale === BASE_LOCALE_KEY) return entry.base.title;
  const translation = entry.translations?.get(locale);
  return translation?.visibility === "published" ? translation.title : entry.base.title;
}

/** そのlocale projectionが公開対象か。draft翻訳の参照を公開経路へ混入させない。 */
function isPublishedProjection(entry: PageEntry, locale: string): boolean {
  if (locale === BASE_LOCALE_KEY) return true;
  return entry.translations?.get(locale)?.visibility === "published";
}

function referenceView(
  reference: ResolvedPageReference,
  other: PageEntry | undefined,
  locale: string
): PageReferenceView {
  return {
    ...(other === undefined ? {} : { pageId: other.name, slug: other.slug, title: displayTitle(other, locale) }),
    target: reference.target,
    ...(reference.label === undefined ? {} : { label: reference.label }),
    ...(reference.targetHeading === undefined ? {} : { heading: reference.targetHeading }),
    ...(reference.resolvedTargetHeadingId === undefined
      ? {}
      : { headingId: reference.resolvedTargetHeadingId }),
    blockId: reference.sourceBlockId,
    locale: reference.sourceLocale,
    status: reference.status
  };
}

/**
 * 閲覧用の関係情報を合成する。`localeKey`は実際に描画されるprojectionのlocale
 * （baseならBASE_LOCALE_KEY）。repository全件のbacklinksではなく、対象Page分だけを返す。
 */
export function pageRelationsView(
  index: RepositoryEntryIndex,
  pageId: string,
  localeKey: string
): PageRelationsView {
  const entry = index.byName.get(pageId);
  if (!entry) return { outgoing: [], incoming: [], diagnostics: [] };

  const outgoing = (index.referencesBySource.get(pageId) ?? [])
    .filter((reference) => reference.sourceLocale === localeKey)
    .map((reference) =>
      referenceView(
        reference,
        reference.resolvedTargetPageId === undefined
          ? undefined
          : index.byName.get(reference.resolvedTargetPageId),
        localeKey
      )
    );

  const seenSources = new Set<string>();
  const incoming: PageReferenceView[] = [];
  for (const reference of index.backlinksByTarget.get(pageId) ?? []) {
    const source = index.byName.get(reference.sourcePageId);
    if (!source) continue;
    // draft翻訳にのみ存在する参照は公開逆参照に含めない。
    if (!isPublishedProjection(source, reference.sourceLocale)) continue;
    if (seenSources.has(source.name)) continue;
    seenSources.add(source.name);
    incoming.push(referenceView(reference, source, localeKey));
  }

  const diagnostics = index.referenceDiagnostics.filter(
    (diagnostic) => diagnostic.pageId === pageId && diagnostic.locale === localeKey
  );
  return { outgoing, incoming, diagnostics };
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
