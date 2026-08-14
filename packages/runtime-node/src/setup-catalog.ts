export type ProjectSize = "personal" | "small-team" | "medium-large";
export type DevelopmentMethod = "agile" | "hybrid" | "waterfall";
export type DocumentationLevel = "light" | "standard" | "strict";
export type SetupMode = "recommended" | "templates" | "empty";
export type SetupRequiredness = "core" | "recommended" | "conditional" | "optional";

export interface LocalizedSetupText {
  ja: string;
  en: string;
}

export interface SetupAreaDefinition {
  id: string;
  order: number;
  title: LocalizedSetupText;
  folderName: LocalizedSetupText;
  description: LocalizedSetupText;
}

export interface SetupTemplateRule {
  templateId: string;
  areaId: string;
  minimumLevel: DocumentationLevel;
  requiredness: SetupRequiredness;
  sizes?: ProjectSize[];
  methods?: DevelopmentMethod[];
  dependencies?: string[];
  related?: string[];
  templateFamilyId?: string;
}

export interface SetupRecommendationInput {
  size: ProjectSize;
  method: DevelopmentMethod;
  level: DocumentationLevel;
}

export interface SetupRecommendation {
  templateIds: string[];
  reasons: Record<string, string>;
}

export const CORE_SETUP_PACK = {
  id: "vellym-core-project-structure",
  schemaVersion: "1.0",
  version: "1.0.0"
} as const;

export const SETUP_AREAS: SetupAreaDefinition[] = [
  area("project-overview", 0, "プロジェクト概要", "Project overview", "00_プロジェクト概要", "00_project-overview", "目的と全体像への入口", "Entry point for purpose and context"),
  area("project-management", 1, "プロジェクト管理", "Project management", "01_プロジェクト管理", "01_project-management", "計画、リスク、進捗、関係者", "Plans, risks, progress, and stakeholders"),
  area("requirements", 2, "要求・要件", "Requirements", "02_要求・要件", "02_requirements", "背景、範囲、機能・非機能要件", "Context, scope, functional and non-functional requirements"),
  area("architecture", 3, "アーキテクチャ", "Architecture", "03_アーキテクチャ", "03_architecture", "構造、制約、重要な技術判断", "Structure, constraints, and significant technical decisions"),
  area("design", 4, "設計", "Design", "04_設計", "04_design", "画面、API、データ等の設計", "UI, API, data, and component design"),
  area("implementation", 5, "実装・構成管理", "Implementation and configuration", "05_実装・構成管理", "05_implementation", "開発方針、構成、build、deploy", "Development policy, configuration, build, and deployment"),
  area("quality", 6, "品質・テスト", "Quality and test", "06_品質・テスト", "06_quality", "品質方針、検証、受入", "Quality policy, verification, and acceptance"),
  area("release", 7, "リリース・移行", "Release and migration", "07_リリース・移行", "07_release", "リリース、移行、rollback", "Release, migration, and rollback"),
  area("operations", 8, "運用・保守", "Operations and maintenance", "08_運用・保守", "08_operations", "監視、復旧、障害、保守", "Monitoring, recovery, incidents, and maintenance"),
  area("closure", 9, "プロジェクト完了", "Project closure", "09_プロジェクト完了", "09_closure", "引継ぎ、振り返り、教訓", "Handover, retrospective, and lessons learned")
];

function area(
  id: string,
  order: number,
  titleJa: string,
  titleEn: string,
  folderJa: string,
  folderEn: string,
  descriptionJa: string,
  descriptionEn: string
): SetupAreaDefinition {
  return {
    id,
    order,
    title: { ja: titleJa, en: titleEn },
    folderName: { ja: folderJa, en: folderEn },
    description: { ja: descriptionJa, en: descriptionEn }
  };
}

const ALL_METHODS: DevelopmentMethod[] = ["agile", "hybrid", "waterfall"];
const ALL_SIZES: ProjectSize[] = ["personal", "small-team", "medium-large"];

export const SETUP_TEMPLATE_RULES: SetupTemplateRule[] = [
  rule("project-guide", "project-overview", "light", "core"),
  rule("project-charter", "project-overview", "light", "core"),
  rule("requirements", "requirements", "light", "core"),
  rule("decision-log", "architecture", "light", "core"),
  rule("roadmap", "project-management", "light", "core"),
  rule("risk-register", "project-management", "light", "core", undefined, undefined, "risk-register"),
  rule("current-position", "project-management", "standard", "recommended"),
  rule("scope", "requirements", "standard", "recommended"),
  rule("arc42-context", "architecture", "standard", "recommended"),
  rule("arc42-strategy", "architecture", "standard", "recommended", undefined, ["arc42-context"]),
  rule("design-overview", "design", "standard", "recommended", undefined, ["requirements"]),
  rule("development-policy", "implementation", "standard", "recommended"),
  rule("test-strategy", "quality", "light", "core", undefined, ["requirements"]),
  rule("product-vision", "project-overview", "standard", "recommended", ["agile", "hybrid"]),
  rule("user-problem", "requirements", "standard", "recommended", ["agile", "hybrid"], ["product-vision"]),
  rule("release-plan", "release", "standard", "recommended"),
  rule("stakeholders", "project-management", "strict", "conditional", undefined, undefined, undefined, ["small-team", "medium-large"]),
  rule("schedule", "project-management", "strict", "conditional", undefined, undefined, undefined, ["small-team", "medium-large"]),
  rule("arc42-building-blocks", "architecture", "strict", "conditional", undefined, ["arc42-context"]),
  rule("arc42-runtime", "architecture", "strict", "conditional", undefined, ["arc42-building-blocks"]),
  rule("product-hypotheses", "requirements", "strict", "conditional", ["agile", "hybrid"], ["user-problem"]),
  rule("test-plan", "quality", "strict", "conditional", undefined, ["test-strategy"]),
  rule("migration-plan", "release", "strict", "conditional", undefined, ["release-plan"]),
  rule("operations-guide", "operations", "strict", "conditional"),
  rule("handover", "closure", "strict", "conditional", undefined, ["operations-guide"]),
  rule("retrospective", "closure", "standard", "recommended", ["agile", "hybrid"]),
  rule("welcome", "project-overview", "strict", "optional"),
  rule("external-ai-document-guide", "project-overview", "strict", "optional"),
  rule("yaml-editing-guide", "project-overview", "strict", "optional")
];

function rule(
  templateId: string,
  areaId: string,
  minimumLevel: DocumentationLevel,
  requiredness: SetupRequiredness,
  methods: DevelopmentMethod[] = ALL_METHODS,
  dependencies?: string[],
  templateFamilyId?: string,
  sizes: ProjectSize[] = ALL_SIZES
): SetupTemplateRule {
  return {
    templateId,
    areaId,
    minimumLevel,
    requiredness,
    methods,
    sizes,
    ...(dependencies?.length ? { dependencies } : {}),
    ...(templateFamilyId ? { templateFamilyId } : {})
  };
}

const LEVEL_RANK: Record<DocumentationLevel, number> = {
  light: 0,
  standard: 1,
  strict: 2
};

export function recommendSetupTemplates(
  input: SetupRecommendationInput
): SetupRecommendation {
  const selected = new Set<string>();
  const reasons: Record<string, string> = {};
  const byId = new Map(SETUP_TEMPLATE_RULES.map((item) => [item.templateId, item]));
  for (const item of SETUP_TEMPLATE_RULES) {
    if (item.requiredness === "optional") continue;
    if (LEVEL_RANK[item.minimumLevel] > LEVEL_RANK[input.level]) continue;
    if (!(item.sizes ?? ALL_SIZES).includes(input.size)) continue;
    if (!(item.methods ?? ALL_METHODS).includes(input.method)) continue;
    selected.add(item.templateId);
    reasons[item.templateId] = `${input.size} / ${input.method} / ${input.level}`;
  }
  const visit = (templateId: string): void => {
    for (const dependency of byId.get(templateId)?.dependencies ?? []) {
      if (selected.has(dependency)) continue;
      selected.add(dependency);
      reasons[dependency] = `dependency of ${templateId}`;
      visit(dependency);
    }
  };
  for (const templateId of [...selected]) visit(templateId);
  const order = new Map(SETUP_TEMPLATE_RULES.map((item, index) => [item.templateId, index]));
  return {
    templateIds: [...selected].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    reasons
  };
}

export function setupRule(templateId: string): SetupTemplateRule | undefined {
  return SETUP_TEMPLATE_RULES.find((item) => item.templateId === templateId);
}
