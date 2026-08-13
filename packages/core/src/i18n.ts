import type { VellymConfig } from "./types.js";

export type SupportedLanguage = "ja" | "en";

const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?(?:-(?:[A-Za-z0-9]{5,8}|\d[A-Za-z0-9]{3}))*$/;

export const RESERVED_LOCALE_SEGMENTS = new Set([
  "api",
  "assets",
  "data",
  "pages",
  "settings"
]);

export interface LocaleNormalization {
  raw: string;
  canonical?: string;
  valid: boolean;
  canonicalInput: boolean;
  reason?: "FORMAT" | "RESERVED";
}

/**
 * Vellym Phase 1 locale identifier subset.
 *
 * Accepts language[-Script][-REGION][-variant...] and deliberately rejects
 * extensions and private-use tags. YAML uses canonical casing while URL
 * segments can use canonical.toLocaleLowerCase().
 */
export function normalizeLocale(raw: string): LocaleNormalization {
  if (!localePattern.test(raw)) {
    return { raw, valid: false, canonicalInput: false, reason: "FORMAT" };
  }
  let canonical: string;
  try {
    canonical = Intl.getCanonicalLocales(raw)[0]!;
  } catch {
    return { raw, valid: false, canonicalInput: false, reason: "FORMAT" };
  }
  if (RESERVED_LOCALE_SEGMENTS.has(canonical.toLocaleLowerCase())) {
    return { raw, canonical, valid: false, canonicalInput: false, reason: "RESERVED" };
  }
  return {
    raw,
    canonical,
    valid: true,
    canonicalInput: raw === canonical
  };
}

export function localeUrlSegment(locale: string): string | undefined {
  const normalized = normalizeLocale(locale);
  return normalized.valid ? normalized.canonical!.toLocaleLowerCase() : undefined;
}

export function resolveDefaultLocale(
  config: Pick<VellymConfig, "ui" | "i18n">
): string {
  const configured = config.i18n?.defaultLocale;
  if (configured) {
    const normalized = normalizeLocale(configured);
    if (normalized.valid) return normalized.canonical!;
  }
  return normalizeLocale(config.ui.language).canonical!;
}

export function resolveBaseLocale(
  resource: { spec: { locale?: string } },
  defaultLocale: string
): string | undefined {
  const candidate = resource.spec.locale ?? defaultLocale;
  const normalized = normalizeLocale(candidate);
  return normalized.valid ? normalized.canonical : undefined;
}

/** Returns the canonical spec.locale that a writer must persist atomically
 * when translations are added for the first time. */
export function persistedBaseLocaleForTranslations(
  resource: { spec: { locale?: string } },
  defaultLocale: string
): string | undefined {
  return resolveBaseLocale(resource, defaultLocale);
}

export function localeDisplayName(
  locale: string,
  _uiLocale: string,
  configuredNames: Record<string, string> = {}
): string {
  const normalized = normalizeLocale(locale);
  const canonical = normalized.canonical ?? locale;
  for (const [configuredLocale, displayName] of Object.entries(configuredNames)) {
    const configured = normalizeLocale(configuredLocale);
    if (
      (normalized.valid && configured.valid && configured.canonical === canonical) ||
      (!normalized.valid && configuredLocale === locale)
    ) {
      return displayName;
    }
  }
  try {
    // 言語切り替えは、現在のUI言語を読めない人も使う。各言語をその言語自身の
    // 表記（日本語、Englishなど）にして、切り替え先を読めるようにする。
    const displayNames = new Intl.DisplayNames([canonical], { type: "language" });
    return displayNames.of(canonical) ?? canonical;
  } catch {
    return canonical;
  }
}
