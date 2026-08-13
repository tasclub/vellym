import {
  normalizeLocale,
  resolveBaseLocale,
  type Folder,
  type Page
} from "@vellym-internal/core";
import { contentHash } from "./path-utils.js";

function hash(value: unknown): string {
  return contentHash(JSON.stringify(value));
}

export function pageLocaleHashes(
  page: Page,
  defaultLocale: string
): Record<string, string> {
  const result: Record<string, string> = {};
  const baseLocale = resolveBaseLocale(page, defaultLocale);
  if (baseLocale) {
    result[baseLocale] = hash({
      title: page.metadata.title,
      blocks: page.spec.blocks
    });
  }
  for (const [rawKey, value] of Object.entries(page.spec.translations ?? {})) {
    const locale = normalizeLocale(rawKey).canonical;
    if (locale && result[locale] === undefined) result[locale] = hash(value);
  }
  return result;
}

export function folderLocaleHashes(
  folder: Folder,
  defaultLocale: string
): Record<string, string> {
  const result: Record<string, string> = {};
  const baseLocale = resolveBaseLocale(folder, defaultLocale);
  if (baseLocale) {
    result[baseLocale] = hash({
      title: folder.metadata.title,
      description: folder.spec.description
    });
  }
  for (const [rawKey, value] of Object.entries(folder.spec.translations ?? {})) {
    const locale = normalizeLocale(rawKey).canonical;
    if (locale && result[locale] === undefined) result[locale] = hash(value);
  }
  return result;
}
