import {
  normalizeLocale,
  type InvalidTranslation,
  type FolderEditView
} from "@vellym-internal/core";

export interface FolderLocaleDraft {
  locale: string;
  isBaseLocale: boolean;
  visibility: "draft" | "published";
  title: string;
  description: string;
  baselineHash?: string;
  operation: "existing" | "create";
  initialize?: { type: "empty" } | { type: "copy"; sourceLocale: string };
  initial?: {
    visibility: "draft" | "published";
    title: string;
    description: string;
  };
  removed: boolean;
}

export interface FolderEditSession {
  folderPath: string;
  baseHash: string | null;
  baseLocale: string;
  activeLocale: string;
  locales: FolderLocaleDraft[];
  invalidTranslations: InvalidTranslation[];
  removeTranslationKeys: string[];
}

export function createFolderEditSession(
  view: FolderEditView,
  activeLocale = view.baseLocale
): FolderEditSession {
  return {
    folderPath: view.folderPath,
    baseHash: view.hash,
    baseLocale: view.baseLocale,
    activeLocale: view.locales.some(({ locale }) => locale === activeLocale)
      ? activeLocale
      : view.baseLocale,
    locales: view.locales.map((item) => {
      const description = item.description ?? "";
      return {
        ...item,
        description,
        operation: "existing" as const,
        initial: {
          visibility: item.visibility,
          title: item.title,
          description
        },
        removed: false
      };
    }),
    invalidTranslations: view.invalidTranslations,
    removeTranslationKeys: []
  };
}

export function addFolderLocale(
  session: FolderEditSession,
  localeInput: string,
  initialize: { type: "empty" } | { type: "copy"; sourceLocale: string }
): FolderEditSession {
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
  return {
    ...session,
    activeLocale: locale,
    locales: [
      ...session.locales.filter((item) => item.locale !== locale),
      {
        locale,
        isBaseLocale: false,
        visibility: "published",
        title: source?.title ?? "",
        description: source?.description ?? "",
        operation: "create",
        initialize,
        removed: false
      }
    ]
  };
}

export function removeFolderLocale(
  session: FolderEditSession,
  locale: string
): FolderEditSession {
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

export function folderLocaleDirty(draft: FolderLocaleDraft): boolean {
  return draft.operation === "create" ||
    draft.removed ||
    !draft.initial ||
    draft.visibility !== draft.initial.visibility ||
    draft.title !== draft.initial.title ||
    draft.description !== draft.initial.description;
}

export function folderEditSessionDirty(session: FolderEditSession): boolean {
  return session.removeTranslationKeys.length > 0 || session.locales.some(folderLocaleDirty);
}

export function deleteInvalidFolderTranslation(
  session: FolderEditSession,
  rawKey: string
): FolderEditSession {
  return {
    ...session,
    invalidTranslations: session.invalidTranslations.filter((item) => item.rawKey !== rawKey),
    removeTranslationKeys: [...session.removeTranslationKeys, rawKey]
  };
}

export function repairInvalidFolderTranslation(
  session: FolderEditSession,
  rawKey: string
): FolderEditSession {
  const invalid = session.invalidTranslations.find((item) => item.rawKey === rawKey);
  if (
    !invalid?.repairable ||
    !invalid.canonicalLocale ||
    invalid.diagnostics.some(({ code }) => code === "DUPLICATE_TRANSLATION_LOCALE")
  ) throw new Error("NOT_REPAIRABLE");
  const value = invalid.value && typeof invalid.value === "object" && !Array.isArray(invalid.value)
    ? invalid.value as Record<string, unknown>
    : {};
  const draft: FolderLocaleDraft = {
    locale: invalid.canonicalLocale,
    isBaseLocale: false,
    visibility: value.visibility === "published" ? "published" : "draft",
    title: typeof value.title === "string" ? value.title : "",
    description: typeof value.description === "string" ? value.description : "",
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

export function folderEditPatch(session: FolderEditSession) {
  const localeChanges = session.locales
    .filter((draft) => !draft.removed && folderLocaleDirty(draft))
    .map((draft) => ({
      locale: draft.locale,
      operation: draft.operation === "create" ? "create" as const : "update" as const,
      ...(draft.baselineHash ? { baselineHash: draft.baselineHash } : {}),
      ...(draft.isBaseLocale ? {} : { visibility: draft.visibility }),
      ...(draft.initialize ? { initialize: draft.initialize } : {}),
      title: draft.title,
      description: draft.description.trim() ? draft.description : null
    }));
  const removeLocales = session.locales
    .filter((draft) => draft.removed && draft.operation === "existing")
    .map(({ locale }) => locale);
  return {
    folderPath: session.folderPath,
    baseHash: session.baseHash,
    localeChanges,
    removeLocales,
    ...(session.removeTranslationKeys.length
      ? { removeTranslationKeys: session.removeTranslationKeys }
      : {})
  };
}
