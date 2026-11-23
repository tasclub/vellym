import { describe, expect, it } from "vitest";
import { pageLanguages, uiLangAttribute } from "../packages/ui-react/src/shell/page-languages.js";

// ticket-01m7f500000000000000000001: <html lang> follows the document, the chrome the UI.
describe("pageLanguages", () => {
  it("separates the English document from the Japanese UI", () => {
    const languages = pageLanguages({ defaultLocale: "ja", requestedLocale: "en", resolvedLocale: "en", uiLocale: "ja" });
    expect(languages).toEqual({ document: "en", ui: "ja" });
    expect(uiLangAttribute(languages)).toBe("ja");
  });
  it("adds no chrome lang when both languages match", () => {
    const languages = pageLanguages({ defaultLocale: "ja", requestedLocale: "ja", resolvedLocale: "ja", uiLocale: "ja" });
    expect(languages).toEqual({ document: "ja", ui: "ja" });
    expect(uiLangAttribute(languages)).toBeUndefined();
  });
  it("prefers the open view's locale and falls back to ja", () => {
    expect(pageLanguages({ resolvedLocale: "ja", uiLocale: "en" }, "en")).toEqual({ document: "en", ui: "en" });
    expect(pageLanguages(undefined)).toEqual({ document: "ja", ui: "ja" });
    expect(pageLanguages({ requestedLocale: "en" })).toEqual({ document: "en", ui: "ja" });
  });
});
