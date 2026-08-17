import { describe, expect, it } from "vitest";
import type { FolderEditView } from "@vellym-internal/core";
import {
  addFolderLocale,
  createFolderEditSession,
  folderEditPatch,
  folderEditSessionDirty,
  removeFolderLocale
} from "../packages/ui-react/src/editor/folder-edit-session.js";

const view: FolderEditView = {
  folderPath: "guides",
  hash: "file-hash",
  baseLocale: "ja",
  locales: [{
    locale: "ja",
    isBaseLocale: true,
    visibility: "published",
    title: "ガイド",
    description: "説明",
    baselineHash: "ja-hash"
  }],
  invalidTranslations: [],
  readOnly: false,
  readOnlyReasons: []
};

describe("FolderEditSession", () => {
  it("keeps unchanged data clean", () => {
    const session = createFolderEditSession(view);
    expect(folderEditSessionDirty(session)).toBe(false);
    expect(folderEditPatch(session)).toEqual({
      folderPath: "guides",
      baseHash: "file-hash",
      localeChanges: [],
      removeLocales: []
    });
  });

  it("copies a locale as published and includes it in one patch", () => {
    const session = addFolderLocale(
      createFolderEditSession(view),
      "en",
      { type: "copy", sourceLocale: "ja" }
    );
    expect(folderEditPatch(session).localeChanges).toEqual([{
      locale: "en",
      operation: "create",
      visibility: "published",
      initialize: { type: "copy", sourceLocale: "ja" },
      title: "ガイド",
      description: "説明"
    }]);
  });

  it("cancels a new locale and marks an existing locale for removal", () => {
    const added = addFolderLocale(
      createFolderEditSession(view),
      "en",
      { type: "empty" }
    );
    expect(folderEditSessionDirty(removeFolderLocale(added, "en"))).toBe(false);

    const existing = createFolderEditSession({
      ...view,
      locales: [...view.locales, {
        locale: "en",
        isBaseLocale: false,
        visibility: "published",
        title: "Guides",
        baselineHash: "en-hash"
      }]
    });
    expect(folderEditPatch(removeFolderLocale(existing, "en")).removeLocales)
      .toEqual(["en"]);
  });
});
