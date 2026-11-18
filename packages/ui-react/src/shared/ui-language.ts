import { createContext, useContext } from "react";

/** The UI language when it differs from the document language (see shell/page-languages.ts). */
export const UiLanguageContext = createContext<string | undefined>(undefined);

/** `lang` for UI chrome and overlays rendered into `document.body`. */
export function useUiLang(): string | undefined {
  return useContext(UiLanguageContext);
}
