import { localeUrlSegment, normalizeLocale } from "@vellym-internal/core";

export interface DocumentLocation {
  locale?: string;
  page?: string;
  heading?: string;
  legacy: boolean;
}

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function resolveDocumentLocation(input: {
  pathname: string;
  hash: string;
  basePath?: string;
  defaultLocale?: string;
}): DocumentLocation {
  const basePath = input.basePath?.replace(/\/$/, "") ?? "";
  const pathname = basePath && input.pathname.startsWith(`${basePath}/`)
    ? input.pathname.slice(basePath.length)
    : input.pathname;
  const segments = pathname.split("/").filter(Boolean);
  const values = new URLSearchParams(
    input.hash.startsWith("#") ? input.hash.slice(1) : input.hash
  );
  const legacyPage = values.get("page") ?? undefined;
  if (legacyPage) {
    const pathLocale = segments.length >= 1
      ? normalizeLocale(segments[0]!).canonical
      : undefined;
    return {
      ...(pathLocale ? { locale: pathLocale } : {}),
      page: legacyPage,
      heading: values.get("heading") ?? undefined,
      legacy: true
    };
  }
  if (segments.length === 3 && segments[1]?.toLocaleLowerCase() === "pages") {
    const normalized = normalizeLocale(segments[0]!);
    const page = decode(segments[2]!);
    if (normalized.valid && page) {
      const rawHeading = input.hash.startsWith("#") ? input.hash.slice(1) : "";
      return {
        locale: normalized.canonical,
        page,
        ...(rawHeading ? { heading: decode(rawHeading) } : {}),
        legacy: false
      };
    }
  }
  if (
    input.defaultLocale &&
    segments.length === 2 &&
    segments[0]?.toLocaleLowerCase() === "pages"
  ) {
    const normalized = normalizeLocale(input.defaultLocale);
    const page = decode(segments[1]!);
    if (normalized.valid && page) {
      const rawHeading = input.hash.startsWith("#") ? input.hash.slice(1) : "";
      return {
        locale: normalized.canonical,
        page,
        ...(rawHeading ? { heading: decode(rawHeading) } : {}),
        legacy: false
      };
    }
  }

  return {
    page: undefined,
    heading: values.get("heading") ?? undefined,
    legacy: true
  };
}

export function documentPagePath(
  locale: string,
  page: string,
  heading?: string
): string {
  const segment = localeUrlSegment(locale);
  if (!segment) throw new Error(`Invalid locale: ${locale}`);
  const staticConfig = typeof window !== "undefined"
    ? window.__VELLYM_STATIC__
    : undefined;
  const staticBase = staticConfig?.appBase;
  const route = staticConfig && locale === staticConfig.defaultLocale
    ? `pages/${encodeURIComponent(page)}/`
    : `${segment}/pages/${encodeURIComponent(page)}/`;
  const path = staticBase
    ? new URL(route, new URL(staticBase, document.baseURI)).pathname
    : `/${route}`;
  return heading ? `${path}#${encodeURIComponent(heading)}` : path;
}

export function staticAppBasePath(): string | undefined {
  if (typeof window === "undefined" || !window.__VELLYM_STATIC__) return undefined;
  return new URL(window.__VELLYM_STATIC__.appBase, document.baseURI)
    .pathname.replace(/\/$/, "");
}

export function localeDirection(locale: string): "ltr" | "rtl" {
  const normalized = normalizeLocale(locale);
  const language = normalized.canonical?.split("-")[0];
  return language && new Set(["ar", "fa", "he", "ur"]).has(language)
    ? "rtl"
    : "ltr";
}
