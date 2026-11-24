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
  it("provides the requirements and architecture templates with localized headings", () => {
    const headings: Record<string, [string[], string[]]> = {
      "functional-requirements": [["目的", "利用者と場面", "要件の表", "受入条件", "関連する画面・データ"], ["Purpose", "Users and scenarios", "Requirements", "Acceptance criteria", "Related screens and data"]],
      "requirements-definition": [["業務の概要", "機能要件の一覧", "非機能要件", "制約", "移行の要件"], ["Business overview", "Functional requirements", "Non-functional requirements", "Constraints", "Migration requirements"]],
      "non-functional-requirements": [["可用性", "性能・拡張性", "運用・保守性", "移行性", "セキュリティ", "システム環境・エコロジー"], ["Availability", "Performance and scalability", "Operations and maintainability", "Migration", "Security", "System environment and ecology"]],
      "business-flow": [["対象の業務", "流れの図", "各手順の説明"], ["Business process", "Flow diagram", "Step descriptions"]],
      "screen-list": [["画面の表", "画面遷移の図"], ["Screens", "Screen transition diagram"]],
      "architecture-overview": [["目標と品質の優先順位", "外部との境界", "構成要素と責務", "重要な流れ", "配置"], ["Goals and quality priorities", "External boundaries", "Components and responsibilities", "Important flows", "Deployment"]],
      "system-design": [["目標と品質の優先順位", "外部との境界", "構成要素と責務", "重要な流れ", "配置", "採用する技術の一覧"], ["Goals and quality priorities", "External boundaries", "Components and responsibilities", "Important flows", "Deployment", "Adopted technologies"]],
      decision: [["状態", "背景", "選択肢", "決定", "結果と影響"], ["Status", "Context", "Options", "Decision", "Consequences and impact"]],
      "design-doc": [["目的と背景", "やらないこと", "案", "代わりの案", "懸念と未決事項"], ["Purpose and context", "Non-goals", "Proposal", "Alternatives", "Concerns and open questions"]],
    };
    const catalog = loadCatalog();
    expect(catalog.templates).toHaveLength(9);
    for (const [id, [ja, en]] of Object.entries(headings)) {
      const template = catalog.templates.find(t => t.id === id);
      expect(template, id).toBeDefined();
      for (const heading of ja) expect(template!.body.ja).toContain(`## ${heading}\n`);
      for (const heading of en) expect(template!.body.en).toContain(`## ${heading}\n`);
      expect(template!.guideText?.ja).toBeTruthy();
      expect(template!.guideText?.en).toBeTruthy();
    }
    expect(catalog.templates.find(t => t.id === "system-design")?.alias).toBe("architecture-overview");
  });
});
