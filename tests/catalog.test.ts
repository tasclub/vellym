import { describe, expect, it } from "vitest";
import { loadCatalog } from "../packages/runtime-node/src/catalog/load.js";
import { ROLES } from "../packages/runtime-node/src/catalog/types.js";
import { validateCatalog } from "../packages/runtime-node/src/catalog/validate.js";

describe("catalog", () => {
  it("loads and caches complete definitions", () => {
    const catalog = loadCatalog();
    expect(loadCatalog()).toBe(catalog);
    expect(catalog.structures).toHaveLength(4);
    for (const structure of catalog.structures.filter(s => !s.supplement)) {
      expect(Object.keys(structure.roleMap).sort()).toEqual([...ROLES].sort());
    }
    expect(catalog.templates[0]?.body.ja).toBeTruthy();
  });
  it("rejects duplicates, broken references, roles and missing locales", () => {
    const duplicate = structuredClone(loadCatalog());
    duplicate.templates.push(duplicate.templates[0]!);
    expect(() => validateCatalog(duplicate)).toThrow();
    const reference = structuredClone(loadCatalog());
    reference.sets[0]!.items.push({ template: "missing" });
    expect(() => validateCatalog(reference)).toThrow();
    const role = structuredClone(loadCatalog());
    delete (role.structures.find(s => !s.supplement)!.roleMap as Partial<typeof role.structures[number]["roleMap"]>).overview;
    expect(() => validateCatalog(role)).toThrow();
    const locale = structuredClone(loadCatalog());
    locale.templates[0]!.title.en = "";
    expect(() => validateCatalog(locale)).toThrow();
  });
  it("requires localized folder descriptions, including nested and supplementary folders", () => {
    for (const structure of loadCatalog().structures) {
      const invalid = structuredClone(loadCatalog());
      const folder = invalid.structures.find(s => s.id === structure.id)!.folders[0]!;
      (folder.children?.[0] ?? folder).description.en = "";
      expect(() => validateCatalog(invalid)).toThrow("description");
    }
  });
  it("supports optional localized document and tracker guide text", () => {
    const catalog = structuredClone(loadCatalog());
    expect(catalog.templates.find(t => t.id === "decision")!.guideText?.en).toContain("decision");
    expect(() => validateCatalog(catalog)).not.toThrow();
    catalog.trackers[0]!.guideText = { ja: "使い方", en: "Usage" };
    expect(() => validateCatalog(catalog)).not.toThrow();
    catalog.trackers[0]!.guideText.en = "";
    expect(() => validateCatalog(catalog)).toThrow("guideText");
    delete catalog.trackers[0]!.guideText;
    catalog.templates[0]!.guideText = { ja: "使い方", en: "" };
    expect(() => validateCatalog(catalog)).toThrow("guideText");
  });
});
