/**
 * A page carries two languages: the document (body text) and the UI (the chrome around it).
 * `<html lang>` follows the document so screen readers, search engines and the static HTML
 * agree; the UI chrome gets its own `lang` when it differs (ticket-01m7f500000000000000000001).
 */
export interface PageLanguageProject {
  defaultLocale?: string;
  requestedLocale?: string;
  resolvedLocale?: string;
  uiLocale?: string;
}

export function pageLanguages(project: PageLanguageProject | undefined, viewLocale?: string): { document: string; ui: string } {
  return {
    document: viewLocale || project?.resolvedLocale || project?.requestedLocale || project?.defaultLocale || "ja",
    ui: project?.uiLocale || "ja"
  };
}

/** The `lang` to put on UI chrome, or undefined when it would only repeat `<html lang>`. */
export function uiLangAttribute(languages: { document: string; ui: string }): string | undefined {
  return languages.ui === languages.document ? undefined : languages.ui;
}
