import { describe, expect, it } from "vitest";
import type { PageEditView } from "@vellym-internal/core";
import {
  addPageLocale,
  createPageEditSession,
  deleteInvalidPageTranslation,
  pageEditExport,
  pageEditPatch,
  pageEditSessionDirty,
  rebasePageEditSession,
  removePageLocale,
  repairInvalidPageTranslation
} from "../packages/ui-react/src/editor/page-edit-session.js";

const editView: PageEditView = {
  pageId: "guide",
  slug: "guide",
  relativePath: "guide.yaml",
  hash: "file-hash",
  baseLocale: "ja",
  locales: [{
    locale: "ja",
    isBaseLocale: true,
    visibility: "published",
    title: "ガイド",
    blocks: [{ id: "body", type: "rich-text", format: "commonmark", content: "本文" }],
    baselineHash: "ja-hash"
  }],
  invalidTranslations: [],
  readOnly: false,
  readOnlyReasons: []
};

describe("PageEditSession", () => {
  it("rebases only the file hash without losing the dirty draft", () => {
    const original = createPageEditSession(editView);
    const session = { ...original, slug: "changed" };
    const rebased = rebasePageEditSession(session, "new-hash");
    expect(rebased).toEqual({ ...session, baseHash: "new-hash" });
    expect(session.baseHash).toBe("file-hash");
    expect(pageEditSessionDirty(rebased)).toBe(true);
    expect(pageEditPatch(rebased)).toMatchObject({ baseHash: "new-hash", slug: "changed" });
  });

  it("keeps an unchanged loaded page clean", () => {
    const session = createPageEditSession(editView);
    expect(pageEditSessionDirty(session)).toBe(false);
    expect(pageEditPatch(session)).toEqual({ baseHash: "file-hash" });
  });

  it("adds a copied locale as published and emits one atomic patch", () => {
    const added = addPageLocale(
      createPageEditSession(editView),
      "en",
      { type: "copy", sourceLocale: "ja" }
    );
    const edited = {
      ...added,
      locales: added.locales.map((draft) =>
        draft.locale === "en" ? { ...draft, title: "Guide" } : draft
      )
    };
    expect(pageEditSessionDirty(edited)).toBe(true);
    expect(pageEditPatch(edited)).toMatchObject({
      baseHash: "file-hash",
      localeChanges: [{
        locale: "en",
        operation: "create",
        visibility: "published",
        initialize: { type: "copy", sourceLocale: "ja" },
        title: "Guide"
      }]
    });
  });

  it("cancels an unsaved locale without emitting a removal", () => {
    const added = addPageLocale(
      createPageEditSession(editView),
      "en",
      { type: "empty" }
    );
    const removed = removePageLocale(added, "en");
    expect(pageEditSessionDirty(removed)).toBe(false);
    expect(pageEditPatch(removed).removeLocales).toBeUndefined();
  });

  it("marks a saved translation for removal and exports every retained draft", () => {
    const session = createPageEditSession({
      ...editView,
      locales: [...editView.locales, {
        locale: "en",
        isBaseLocale: false,
        visibility: "published",
        title: "Guide",
        blocks: [],
        baselineHash: "en-hash"
      }]
    }, "en");
    const removed = removePageLocale(session, "en");
    expect(pageEditPatch(removed).removeLocales).toEqual(["en"]);
    expect(pageEditExport(removed)).toContain("## ja — ガイド");
    expect(pageEditExport(removed)).not.toContain("## en");
  });

  it("repairs or explicitly deletes isolated invalid translations", () => {
    const invalidView: PageEditView = {
      ...editView,
      invalidTranslations: [{
        rawKey: "en",
        canonicalLocale: "en",
        path: "/spec/translations/en",
        repairable: true,
        value: { title: 42, blocks: [] },
        diagnostics: [{
          file: "guide.yaml",
          path: "/spec/translations/en/title",
          severity: "error",
          code: "PAGE_TRANSLATION_SCHEMA",
          message: "title must be a string"
        }]
      }]
    };
    const repaired = repairInvalidPageTranslation(
      createPageEditSession(invalidView),
      "en"
    );
    expect(repaired.activeLocale).toBe("en");
    expect(pageEditPatch(repaired).localeChanges).toMatchObject([{
      locale: "en",
      operation: "update",
      visibility: "draft"
    }]);

    const deleted = deleteInvalidPageTranslation(
      createPageEditSession(invalidView),
      "en"
    );
    expect(pageEditPatch(deleted).removeTranslationKeys).toEqual(["en"]);
  });
});
