import { resolveBaseLocale, normalizeLocale } from "./i18n.js";
import type {
  Folder,
  FolderTranslation,
  LocalizedFolderProjection,
  LocalizedPageProjection,
  Page,
  PageTranslation,
  ValidTranslation
} from "./types.js";
import {
  knownRichTextBlocks,
  knownRichTextBlocksFrom,
  validateFolder,
  validatePage
} from "./validation.js";

function withoutTranslations<T extends { translations?: Record<string, unknown> }>(
  spec: T
): Omit<T, "translations"> {
  const { translations: _translations, ...rest } = spec;
  return rest;
}

function findTranslation<T>(
  translations: ValidTranslation<T>[],
  locale: string
): ValidTranslation<T> | undefined {
  return translations.find((translation) => translation.locale === locale);
}

export function projectPage(
  page: Page,
  requestedLocale: string,
  defaultLocale: string,
  file = ""
): LocalizedPageProjection | undefined {
  const requested = normalizeLocale(requestedLocale);
  const baseLocale = resolveBaseLocale(page, defaultLocale);
  if (!requested.valid || !baseLocale) return undefined;

  if (requested.canonical === baseLocale) {
    const projected: Page = {
      ...page,
      spec: { ...withoutTranslations(page.spec), blocks: page.spec.blocks }
    };
    return {
      page: projected,
      locale: baseLocale,
      baseLocale,
      isBaseLocale: true,
      visibility: "published",
      knownBlocks: knownRichTextBlocks(projected, file).blocks
    };
  }

  const validated = validatePage(page, file);
  const match = findTranslation<PageTranslation>(
    validated.translations,
    requested.canonical!
  );
  if (!match || (match.value.visibility ?? "published") !== "published") {
    return undefined;
  }
  const projected: Page = {
    ...page,
    metadata: { ...page.metadata, title: match.value.title },
    spec: { ...withoutTranslations(page.spec), blocks: match.value.blocks }
  };
  return {
    page: projected,
    locale: match.locale,
    baseLocale,
    isBaseLocale: false,
    visibility: "published",
    knownBlocks: knownRichTextBlocksFrom(
      match.value.blocks,
      file,
      `/spec/translations/${match.rawKey}/blocks`
    ).blocks
  };
}

export function projectFolder(
  folder: Folder,
  requestedLocale: string,
  defaultLocale: string,
  file = ""
): LocalizedFolderProjection | undefined {
  const requested = normalizeLocale(requestedLocale);
  const baseLocale = resolveBaseLocale(folder, defaultLocale);
  if (!requested.valid || !baseLocale) return undefined;

  const baseFolder: Folder = {
    ...folder,
    spec: { ...withoutTranslations(folder.spec) }
  };
  if (requested.canonical === baseLocale) {
    return {
      folder: baseFolder,
      locale: baseLocale,
      baseLocale,
      isBaseLocale: true,
      sourceLocale: baseLocale
    };
  }

  const validated = validateFolder(folder, file);
  const match = findTranslation<FolderTranslation>(
    validated.translations,
    requested.canonical!
  );
  if (!match || (match.value.visibility ?? "published") !== "published") {
    return {
      folder: baseFolder,
      locale: requested.canonical!,
      baseLocale,
      isBaseLocale: false,
      sourceLocale: baseLocale
    };
  }
  return {
    folder: {
      ...baseFolder,
      metadata: { ...baseFolder.metadata, title: match.value.title },
      spec: {
        ...baseFolder.spec,
        ...(match.value.description === undefined
          ? {}
          : { description: match.value.description })
      }
    },
    locale: match.locale,
    baseLocale,
    isBaseLocale: false,
    sourceLocale: match.locale
  };
}

export function publishedPageLocales(
  page: Page,
  defaultLocale: string,
  file = ""
): string[] {
  const baseLocale = resolveBaseLocale(page, defaultLocale);
  if (!baseLocale) return [];
  const validated = validatePage(page, file);
  return [
    baseLocale,
    ...validated.translations
      .filter(({ value }) => (value.visibility ?? "published") === "published")
      .map(({ locale }) => locale)
  ];
}

export function projectLocales(
  pages: Page[],
  folders: Folder[],
  defaultLocale: string
): string[] {
  const normalizedDefault = normalizeLocale(defaultLocale);
  if (!normalizedDefault.valid) return [];
  const locales = new Set<string>([normalizedDefault.canonical!]);
  for (const resource of [...pages, ...folders]) {
    const locale = resolveBaseLocale(resource, normalizedDefault.canonical!);
    if (locale) locales.add(locale);
  }
  for (const page of pages) {
    for (const locale of publishedPageLocales(
      page,
      normalizedDefault.canonical!
    )) {
      locales.add(locale);
    }
  }
  const [first, ...rest] = [...locales];
  return [first!, ...rest.sort((left, right) => left.localeCompare(right))];
}
