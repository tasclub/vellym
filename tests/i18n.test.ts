import { describe, expect, it } from "vitest";
import {
  API_VERSION,
  localeDisplayName,
  localeUrlSegment,
  normalizeLocale,
  persistedBaseLocaleForTranslations,
  projectFolder,
  projectLocales,
  projectPage,
  publishedPageLocales,
  resolveDefaultLocale,
  validateConfig,
  validateFolder,
  validatePage,
  type Folder,
  type Page,
  type VellymConfig
} from "@vellym-internal/core";

const baseBlock = {
  id: "body",
  type: "rich-text",
  format: "commonmark",
  content: "## 日本語"
};

function multilingualPage(): Page {
  return {
    apiVersion: API_VERSION,
    kind: "Page",
    metadata: { name: "guide", title: "ガイド", slug: "guide" },
    spec: {
      locale: "ja",
      blocks: [baseBlock],
      translations: {
        en: {
          title: "Guide",
          blocks: [{ ...baseBlock, content: "## English" }],
          vendor: { preserved: true }
        },
        fr: {
          visibility: "draft",
          title: "",
          blocks: []
        }
      }
    }
  };
}

describe("locale identifiers and config", () => {
  it("normalizes the supported BCP 47 subset and URL casing", () => {
    expect(normalizeLocale("EN-us")).toMatchObject({
      valid: true,
      canonical: "en-US",
      canonicalInput: false
    });
    expect(localeUrlSegment("zh-Hant-TW")).toBe("zh-hant-tw");
    expect(normalizeLocale("en-u-ca-japanese").valid).toBe(false);
    expect(normalizeLocale("x-private").valid).toBe(false);
    expect(normalizeLocale("api").reason).toBe("RESERVED");
  });

  it("keeps ui language as the backward-compatible default", () => {
    const config: VellymConfig = {
      schemaVersion: "1.0",
      contentRoot: "content",
      outputDir: "dist",
      ui: { language: "ja" },
      plugins: []
    };
    expect(resolveDefaultLocale(config)).toBe("ja");
    expect(resolveDefaultLocale({
      ...config,
      i18n: { defaultLocale: "fr" }
    })).toBe("fr");
  });

  it("uses configured locale display names before Intl.DisplayNames", () => {
    expect(localeDisplayName("en-US", "ja", { "en-US": "US English" })).toBe(
      "US English"
    );
    expect(localeDisplayName("en", "ja")).toBe("English");
    expect(localeDisplayName("ja", "en")).toBe("日本語");
  });

  it("validates optional i18n config without making it mandatory", () => {
    const legacy = {
      schemaVersion: "1.0",
      contentRoot: "content",
      outputDir: "dist",
      ui: { language: "ja" },
      plugins: []
    };
    expect(validateConfig(legacy, "vellym.config.yaml").config).toEqual(legacy);
    expect(validateConfig({
      ...legacy,
      i18n: { defaultLocale: "en-US", displayNames: { "en-US": "English" } }
    }, "vellym.config.yaml").config).toBeDefined();
    expect(validateConfig({
      ...legacy,
      i18n: { defaultLocale: "en-u-ca-japanese" }
    }, "vellym.config.yaml").config).toBeUndefined();
  });

  it("provides the locale a writer must fix on first translation save", () => {
    const page = multilingualPage();
    delete page.spec.locale;
    expect(persistedBaseLocaleForTranslations(page, "ja")).toBe("ja");
    page.spec.locale = persistedBaseLocaleForTranslations(page, "ja");
    expect(persistedBaseLocaleForTranslations(page, "en")).toBe("ja");
  });
});

describe("translation validation", () => {
  it("returns valid translations separately and accepts an empty draft", () => {
    const result = validatePage(multilingualPage(), "guide.yaml");
    expect(result.page).toBeDefined();
    expect(result.translations.map(({ locale }) => locale)).toEqual(["en", "fr"]);
    expect(result.invalidTranslations).toEqual([]);
    expect(result.translations[0]?.value.vendor).toEqual({ preserved: true });
  });

  it("requires a fixed base locale once translations exist", () => {
    const page = multilingualPage();
    delete page.spec.locale;
    const result = validatePage(page, "guide.yaml");
    expect(result.page).toBeDefined();
    expect(result.translations).toEqual([]);
    expect(result.invalidTranslations).toHaveLength(2);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "LOCALE_REQUIRED_FOR_TRANSLATIONS" })
    ]));
  });

  it("isolates one invalid translation without rejecting the base page", () => {
    const page = multilingualPage();
    page.spec.translations!.de = { title: 42, blocks: [] };
    const result = validatePage(page, "guide.yaml");
    expect(result.page?.metadata.title).toBe("ガイド");
    expect(result.translations.map(({ locale }) => locale)).toEqual(["en", "fr"]);
    expect(result.invalidTranslations).toEqual([
      expect.objectContaining({ rawKey: "de", repairable: true })
    ]);
  });

  it("detects canonical duplicates and base-locale duplication", () => {
    const page = multilingualPage();
    page.spec.translations = {
      en: { title: "English", blocks: [] },
      EN: { title: "Duplicate", blocks: [] },
      ja: { title: "重複", blocks: [] }
    };
    const result = validatePage(page, "guide.yaml");
    expect(result.translations).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_TRANSLATION_LOCALE",
        "DUPLICATE_BASE_LOCALE"
      ])
    );
  });

  it("validates Folder translations with the same locale rules", () => {
    const folder: Folder = {
      apiVersion: API_VERSION,
      kind: "Folder",
      metadata: { title: "利用ガイド" },
      spec: {
        locale: "ja",
        description: "説明",
        translations: {
          en: { title: "User guide", description: "Description" }
        }
      }
    };
    expect(validateFolder(folder, "_index.yaml").translations[0]).toMatchObject({
      locale: "en",
      value: { title: "User guide" }
    });
  });
});

describe("locale projection", () => {
  it("projects published content without exposing all translations", () => {
    const projected = projectPage(multilingualPage(), "en", "ja", "guide.yaml");
    expect(projected).toMatchObject({
      locale: "en",
      baseLocale: "ja",
      isBaseLocale: false,
      page: { metadata: { title: "Guide" } }
    });
    expect(projected?.page.spec.blocks[0]).toMatchObject({ content: "## English" });
    expect(projected?.page.spec.translations).toBeUndefined();
    expect(projected?.knownBlocks[0]?.content).toBe("## English");
  });

  it("supports an English base with a Japanese translation", () => {
    const page = multilingualPage();
    page.metadata.title = "Guide";
    page.spec.locale = "en";
    page.spec.blocks = [{ ...baseBlock, content: "## English" }];
    page.spec.translations = {
      ja: { title: "ガイド", blocks: [baseBlock] }
    };
    expect(projectPage(page, "ja", "en")).toMatchObject({
      baseLocale: "en",
      locale: "ja",
      page: { metadata: { title: "ガイド" } }
    });
  });

  it("does not publish draft or missing translations", () => {
    expect(projectPage(multilingualPage(), "fr", "ja")).toBeUndefined();
    expect(projectPage(multilingualPage(), "de", "ja")).toBeUndefined();
    expect(publishedPageLocales(multilingualPage(), "ja")).toEqual(["ja", "en"]);
  });

  it("falls Folder labels back to the base language with source locale", () => {
    const folder: Folder = {
      apiVersion: API_VERSION,
      kind: "Folder",
      metadata: { title: "資料" },
      spec: { locale: "ja", description: "説明" }
    };
    expect(projectFolder(folder, "en", "ja")).toMatchObject({
      locale: "en",
      sourceLocale: "ja",
      folder: { metadata: { title: "資料" } }
    });
  });

  it("collects the default, resource bases, and published Page locales", () => {
    const frenchFolder: Folder = {
      apiVersion: API_VERSION,
      kind: "Folder",
      metadata: { title: "Dossier" },
      spec: { locale: "fr" }
    };
    expect(projectLocales([multilingualPage()], [frenchFolder], "ja")).toEqual([
      "ja",
      "en",
      "fr"
    ]);
  });
});
