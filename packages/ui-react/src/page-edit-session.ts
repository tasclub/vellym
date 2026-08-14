import {
  normalizeLocale,
  type InvalidTranslation,
  type PageEditView,
  type RichTextBlock
} from "@vellym-internal/core";

export interface LocaleDraft {
  locale: string;
  isBaseLocale: boolean;
  visibility: "draft" | "published";
  title: string;
  blocks: RichTextBlock[];
  baselineHash?: string;
  operation: "existing" | "create";
  initialize?: { type: "empty" } | { type: "copy"; sourceLocale: string };
  initial?: {
    visibility: "draft" | "published";
    title: string;
    blocks: RichTextBlock[];
  };
  removed: boolean;
}

export interface PageEditSession {
  pageId: string;
  baseHash: string;
  baseLocale: string;
  activeLocale: string;
  slug: string;
  initialSlug: string;
  relativePath: string;
  locales: LocaleDraft[];
  invalidTranslations: InvalidTranslation[];
  removeTranslationKeys: string[];
}

function cloneBlocks(blocks: RichTextBlock[]): RichTextBlock[] {
  return blocks.map((block) => ({ ...block }));
}

export function createPageEditSession(
  view: PageEditView,
  activeLocale = view.baseLocale
): PageEditSession {
  const active = view.locales.some(({ locale }) => locale === activeLocale)
    ? activeLocale
    : view.baseLocale;
  return {
    pageId: view.pageId,
    baseHash: view.hash,
    baseLocale: view.baseLocale,
    activeLocale: active,
    slug: view.slug,
    initialSlug: view.slug,
    relativePath: view.relativePath,
    locales: view.locales.map((locale) => ({
      ...locale,
      blocks: cloneBlocks(locale.blocks),
      operation: "existing",
      initial: {
        visibility: locale.visibility,
        title: locale.title,
        blocks: cloneBlocks(locale.blocks)
      },
      removed: false
    })),
    invalidTranslations: view.invalidTranslations,
    removeTranslationKeys: []
  };
}

export function addPageLocale(
  session: PageEditSession,
  localeInput: string,
  initialize: { type: "empty" } | { type: "copy"; sourceLocale: string }
): PageEditSession {
  const normalized = normalizeLocale(localeInput);
  if (!normalized.valid) throw new Error("INVALID_LOCALE");
  const locale = normalized.canonical!;
  if (session.locales.some((item) => item.locale === locale && !item.removed)) {
    throw new Error("LOCALE_EXISTS");
  }
  const source = initialize.type === "copy"
    ? session.locales.find(
        (item) => item.locale === initialize.sourceLocale && !item.removed
      )
    : undefined;
  if (initialize.type === "copy" && !source) throw new Error("SOURCE_MISSING");
  const draft: LocaleDraft = {
    locale,
    isBaseLocale: false,
    visibility: "published",
    title: source?.title ?? "",
    blocks: source ? cloneBlocks(source.blocks) : [],
    operation: "create",
    initialize,
    removed: false
  };
  return {
    ...session,
    activeLocale: locale,
    locales: [
      ...session.locales.filter((item) => item.locale !== locale),
      draft
    ]
  };
}

export function removePageLocale(
  session: PageEditSession,
  locale: string
): PageEditSession {
  if (locale === session.baseLocale) throw new Error("BASE_LOCALE");
  const target = session.locales.find((item) => item.locale === locale);
  if (!target) return session;
  const locales = target.operation === "create"
    ? session.locales.filter((item) => item.locale !== locale)
    : session.locales.map((item) =>
        item.locale === locale ? { ...item, removed: true } : item
      );
  return {
    ...session,
    locales,
    activeLocale:
      session.activeLocale === locale ? session.baseLocale : session.activeLocale
  };
}

export function sameBlocks(
  left: RichTextBlock[],
  right: RichTextBlock[]
): boolean {
  return left.length === right.length && left.every((block, index) => {
    const compared = right[index];
    return Boolean(
      compared &&
      block.id === compared.id &&
      block.content === compared.content
    );
  });
}

export function localeDraftDirty(draft: LocaleDraft): boolean {
  if (draft.operation === "create" || draft.removed || !draft.initial) return true;
  return draft.visibility !== draft.initial.visibility ||
    draft.title !== draft.initial.title ||
    !sameBlocks(draft.blocks, draft.initial.blocks);
}

export function pageEditSessionDirty(session: PageEditSession): boolean {
  return session.slug !== session.initialSlug ||
    session.removeTranslationKeys.length > 0 ||
    session.locales.some(localeDraftDirty);
}

export function deleteInvalidPageTranslation(
  session: PageEditSession,
  rawKey: string
): PageEditSession {
  return {
    ...session,
    invalidTranslations: session.invalidTranslations.filter((item) => item.rawKey !== rawKey),
    removeTranslationKeys: [...session.removeTranslationKeys, rawKey]
  };
}

export function repairInvalidPageTranslation(
  session: PageEditSession,
  rawKey: string
): PageEditSession {
  const invalid = session.invalidTranslations.find((item) => item.rawKey === rawKey);
  if (
    !invalid?.repairable ||
    !invalid.canonicalLocale ||
    invalid.diagnostics.some(({ code }) => code === "DUPLICATE_TRANSLATION_LOCALE")
  ) {
    throw new Error("NOT_REPAIRABLE");
  }
  const value = invalid.value && typeof invalid.value === "object" && !Array.isArray(invalid.value)
    ? invalid.value as Record<string, unknown>
    : {};
  const blocks = (Array.isArray(value.blocks) ? value.blocks : [])
    .filter((block): block is RichTextBlock => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return false;
      const item = block as Record<string, unknown>;
      return item.type === "rich-text" && item.format === "commonmark" &&
        typeof item.id === "string" && typeof item.content === "string";
    })
    .map((block) => ({ ...block }));
  const draft: LocaleDraft = {
    locale: invalid.canonicalLocale,
    isBaseLocale: false,
    visibility: value.visibility === "published" ? "published" : "draft",
    title: typeof value.title === "string" ? value.title : "",
    blocks,
    operation: "existing",
    removed: false
  };
  return {
    ...session,
    activeLocale: draft.locale,
    locales: [...session.locales, draft],
    invalidTranslations: session.invalidTranslations.filter((item) => item.rawKey !== rawKey)
  };
}

export interface PageEditPatch {
  baseHash: string;
  title?: string;
  slug?: string;
  richTextBlocks?: Array<{ id: string; content: string }>;
  localeChanges?: Array<{
    locale: string;
    operation: "create" | "update";
    baselineHash?: string;
    visibility?: "draft" | "published";
    initialize?: { type: "empty" } | { type: "copy"; sourceLocale: string };
    title?: string;
    richTextBlocks?: Array<{ id: string; content: string }>;
  }>;
  removeLocales?: string[];
  removeTranslationKeys?: string[];
}

export function pageEditPatch(session: PageEditSession): PageEditPatch {
  const base = session.locales.find(({ isBaseLocale }) => isBaseLocale)!;
  const patch: PageEditPatch = { baseHash: session.baseHash };
  if (session.slug !== session.initialSlug) patch.slug = session.slug;
  if (localeDraftDirty(base) && base.initial) {
    if (base.title !== base.initial.title) patch.title = base.title;
    if (!sameBlocks(base.blocks, base.initial.blocks)) {
      patch.richTextBlocks = base.blocks.map(({ id, content }) => ({ id, content }));
    }
  }
  const changes = session.locales
    .filter((draft) => !draft.isBaseLocale && !draft.removed && localeDraftDirty(draft))
    .map((draft) => ({
      locale: draft.locale,
      operation: draft.operation === "create" ? "create" as const : "update" as const,
      ...(draft.baselineHash ? { baselineHash: draft.baselineHash } : {}),
      visibility: draft.visibility,
      ...(draft.initialize ? { initialize: draft.initialize } : {}),
      title: draft.title,
      richTextBlocks: draft.blocks.map(({ id, content }) => ({ id, content }))
    }));
  if (changes.length) patch.localeChanges = changes;
  const removals = session.locales
    .filter((draft) => !draft.isBaseLocale && draft.removed && draft.operation === "existing")
    .map(({ locale }) => locale);
  if (removals.length) patch.removeLocales = removals;
  if (session.removeTranslationKeys.length) {
    patch.removeTranslationKeys = session.removeTranslationKeys;
  }
  return patch;
}

export function pageEditExport(session: PageEditSession): string {
  return session.locales
    .filter(({ removed }) => !removed)
    .map((draft) => [
      `## ${draft.locale} — ${draft.title}`,
      ...draft.blocks.map(({ content }) => content.trim()).filter(Boolean)
    ].join("\n\n"))
    .join("\n\n---\n\n") + "\n";
}
