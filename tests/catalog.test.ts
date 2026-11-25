import { describe, expect, it } from "vitest";
import { loadCatalog } from "../packages/runtime-node/src/catalog/load.js";
import { ROLES } from "../packages/runtime-node/src/catalog/types.js";
import { validateCatalog } from "../packages/runtime-node/src/catalog/validate.js";
import { loadPlugins, pluginResourceTemplates } from "../packages/runtime-node/src/plugins.js";
import work from "../packages/plugin-tickets/templates/work.json";
import { validatePluginManifest } from "../packages/core/src/index.js";
import { projectTicket, readTrackers, trackerDefinitionDiagnostics } from "../packages/ticket-engine/src/index.js";
const resources = [{ ...work, id: "tickets:work", pluginId: "tickets",
  group: { ja: "チケット管理を作る", en: "Create ticket management" } }];

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
  it("supports optional localized document and resource guide text", () => {
    const catalog = structuredClone(loadCatalog(resources));
    expect(catalog.templates.find(t => t.id === "decision")!.guideText?.en).toContain("decision");
    expect(() => validateCatalog(catalog)).not.toThrow();
    catalog.resources[0]!.guideText = { ja: "使い方", en: "Usage" };
    expect(() => validateCatalog(catalog)).not.toThrow();
    catalog.resources[0]!.guideText.en = "";
    expect(() => validateCatalog(catalog)).toThrow("guideText");
    delete catalog.resources[0]!.guideText;
    catalog.templates[0]!.guideText = { ja: "使い方", en: "" };
    expect(() => validateCatalog(catalog)).toThrow("guideText");
  });
  it("loads namespaced templates only from enabled plugins without caching them", async () => {
    const registry = await loadPlugins({ configDir: process.cwd(), packageNames: ["@vellym/tickets"], hostVersion: "0.5.0-beta" });
    expect(registry.plugins).toHaveLength(1);
    const loaded = pluginResourceTemplates(registry.plugins);
    expect(loaded).toHaveLength(8);
    expect(loaded.find(item => item.id === "tickets:work")).toEqual(resources[0]);
    expect(loadCatalog(loaded).resources).toEqual(loaded);
    expect(loadCatalog().resources).toEqual([]);
    expect(pluginResourceTemplates([])).toEqual([]);
    expect(loadCatalog().sets.find(s => s.id === "sprint")!.repeat?.page).toBe("sprint");
  });
  it("provides complete sets and valid localized tracker definitions", async () => {
    const registry = await loadPlugins({ configDir: process.cwd(), packageNames: ["@vellym/tickets"], hostVersion: "0.5.0-beta" });
    const templates = pluginResourceTemplates(registry.plugins);
    const catalog = loadCatalog(templates);
    const expected: Record<string, string[]> = {
      start: ["project-charter", "background-and-problem", "stakeholders", "glossary"],
      planning: ["roadmap", "current-status", "scope", "tickets:work", "tickets:risk"],
      predictive: ["project-plan", "communication-plan", "tickets:issue", "tickets:qa", "tickets:change-request"],
      iterative: ["tickets:backlog"], requirements: ["functional-requirements", "non-functional-requirements"],
      design: ["architecture-overview", "decision", "screen-design", "data-design"],
      "quality-release": ["test-plan", "acceptance-scenario", "release-record", "tickets:bug"],
      operations: ["operations-design", "incident-response"], sprint: [], phase: ["tickets:review"]
    };
    expect(catalog.sets).toHaveLength(10);
    for (const set of catalog.sets) {
      expect(set.items.map(item => "template" in item ? item.template : item.resource)).toEqual(expected[set.id]);
    }
    expect(catalog.sets.find(s => s.id === "phase")?.repeat?.page).toBe("phase");
    for (const template of templates) for (const locale of ["ja", "en"] as const) {
      const spec = template.spec[locale];
      const record = { kind: "TicketTracker", name: "tracker", title: "Tracker", relativePath: "tracker.yaml", readOnly: false, spec };
      expect(trackerDefinitionDiagnostics([record]), `${template.id} ${locale}`).toEqual([]);
      if (["tickets:work", "tickets:backlog", "tickets:bug"].includes(template.id)) {
        const trackers = readTrackers({ records: () => [record] });
        const ticket = { ...record, kind: "Ticket", name: "ticket", relativePath: "ticket.yaml", spec: { status: "done", fields: {} } };
        expect(projectTicket(trackers, ticket)?.diagnostics?.map(d => d.code)).toContain("TICKET_RULE_VIOLATION");
        expect(projectTicket(trackers, { ...ticket, spec: { status: "done", fields: { updatedDocuments: "None needed" } } })?.diagnostics ?? []).toEqual([]);
      }
    }
    // The CLI validate of every template runs in catalog-validate.integration.test.ts.
  });
  it("rejects malformed resource definitions and duplicate contributions", () => {
    const catalog = structuredClone(loadCatalog(resources));
    catalog.resources.push(catalog.resources[0]!);
    expect(() => validateCatalog(catalog)).toThrow("duplicate");
    catalog.resources.pop();
    catalog.resources[0]!.fileName.en = "../escape.yaml";
    expect(() => validateCatalog(catalog)).toThrow("fileName");
  });
  it("validates manifest template paths and both group locales", () => {
    const declaration = { id: "work", file: "templates/work.json", group: resources[0]!.group };
    const manifest = { id: "example", contributes: { templates: [declaration] } };
    expect(validatePluginManifest(manifest).manifest).toBeDefined();
    for (const file of ["../outside.json", "/absolute.json", "templates\\work.json"]) {
      expect(validatePluginManifest({ ...manifest, contributes: { templates: [{ ...declaration, file }] } }).manifest).toBeUndefined();
    }
    expect(validatePluginManifest({ ...manifest, contributes: { templates: [{ ...declaration, group: { ja: "のみ" } }] } }).manifest).toBeUndefined();
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
      "screen-design": [["画面の目的", "レイアウト", "項目の表", "操作とイベント", "エラーの表示"], ["Screen purpose", "Layout", "Fields", "Actions and events", "Error display"]],
      "report-design": [["帳票の目的", "レイアウト", "項目の表", "出力の条件"], ["Report purpose", "Layout", "Fields", "Output conditions"]],
      "api-design": [["エンドポイントの表", "入力と出力", "エラー"], ["Endpoints", "Inputs and outputs", "Errors"]],
      "external-interface-design": [["相手先", "方式", "タイミング", "項目の表", "エラー時と再送"], ["Counterparty", "Method", "Timing", "Fields", "Errors and retries"]],
      "data-design": [["ER図", "テーブル定義の表", "保持期間"], ["ER diagram", "Table definitions", "Retention period"]],
      "batch-design": [["起動の条件と時刻", "入力と出力", "処理の流れ", "エラーと再実行"], ["Trigger and schedule", "Inputs and outputs", "Processing flow", "Errors and reruns"]],
      "detailed-design": [["対象のモジュール", "処理の流れ", "クラス・関数の責務の表", "例外"], ["Target module", "Processing flow", "Class and function responsibilities", "Exceptions"]],
    };
    const catalog = loadCatalog();
    expect(catalog.templates).toHaveLength(39);
    for (const [id, [ja, en]] of Object.entries(headings)) {
      const template = catalog.templates.find(t => t.id === id);
      expect(template, id).toBeDefined();
      for (const heading of ja) expect(template!.body.ja).toContain(`## ${heading}\n`);
      for (const heading of en) expect(template!.body.en).toContain(`## ${heading}\n`);
      expect(template!.guideText?.ja).toBeTruthy();
      expect(template!.guideText?.en).toBeTruthy();
    }
    expect(catalog.templates.find(t => t.id === "system-design")?.alias).toBe("architecture-overview");
    for (const locale of ["ja", "en"] as const) {
      expect(catalog.templates.find(t => t.id === "data-design")!.body[locale]).toContain("```mermaid\nerDiagram");
    }
  });
  it("provides localized development, quality, release and operations templates", () => {
    const headings: Record<string, [string[], string[]]> = {
      "development-rules": [["ブランチとレビュー", "コミットのメッセージ", "コーディングの決まり", "完了の定義"], ["Branches and reviews", "Commit messages", "Coding conventions", "Definition of done"]],
      "environment-build-deploy": [["環境の表", "ビルドの手順", "デプロイの手順と確認"], ["Environments", "Build procedure", "Deployment and verification"]],
      "test-plan": [["対象と範囲", "テストの段階と完了条件", "環境", "体制と日程"], ["Scope", "Test levels and completion criteria", "Environment", "Roles and schedule"]],
      "test-specification": [["観点", "テストケースの表"], ["Test perspectives", "Test cases"]],
      "acceptance-scenario": [["機能ごとのシナリオ", "自動で確かめる手順"], ["Scenarios by feature", "Automated verification"]],
      "release-record": [["版・日付・タグ", "含むもの", "入らなかったもの", "判定", "利用者向けの変更点", "振り返りへのリンク"], ["Version, date and tag", "Included work", "Excluded work", "Release decision", "User-facing changes", "Retrospective link"]],
      "migration-plan": [["移行の対象", "方式と手順", "確かめ方", "切り戻しの条件と手順"], ["Migration scope", "Method and procedure", "Verification", "Rollback conditions and procedure"]],
      "operations-design": [["運用の体制", "監視の表", "バックアップと復旧", "定常作業"], ["Operations roles", "Monitoring", "Backup and recovery", "Routine tasks"]],
      "incident-response": [["検知と連絡先", "切り分けの手順", "暫定対応", "記録の残し方"], ["Detection and contacts", "Diagnosis", "Temporary response", "Recording the incident"]],
    };
    const catalog = loadCatalog();
    for (const [id, [ja, en]] of Object.entries(headings)) {
      const template = catalog.templates.find(t => t.id === id);
      expect(template, id).toBeDefined();
      for (const heading of ja) expect(template!.body.ja).toContain(`## ${heading}\n`);
      for (const heading of en) expect(template!.body.en).toContain(`## ${heading}\n`);
      expect(template!.guideText?.ja).toBeTruthy();
      expect(template!.guideText?.en).toBeTruthy();
    }
  });
  it("provides all 14 overview and management templates with localized headings", () => {
    const headings: Record<string, [string[], string[]]> = {
  "project-charter": [
    [
      "目的",
      "成功の物差し",
      "範囲とやらないこと",
      "関係者と権限",
      "前提と制約",
      "主な節目"
    ],
    [
      "Purpose",
      "Measures of success",
      "Scope and non-goals",
      "Stakeholders and authority",
      "Assumptions and constraints",
      "Major milestones"
    ]
  ],
  "background-and-problem": [
    [
      "誰が",
      "今どうしていて",
      "何に困っているか",
      "代わりの手段",
      "解決したら何が変わるか"
    ],
    [
      "Who",
      "Current situation",
      "Problems",
      "Alternatives",
      "Expected change"
    ]
  ],
  "stakeholders": [
    [
      "関係者の表",
      "体制",
      "承認者"
    ],
    [
      "Stakeholders",
      "Roles and responsibilities",
      "Approvers"
    ]
  ],
  "glossary": [
    [
      "用語の表"
    ],
    [
      "Terms"
    ]
  ],
  "roadmap": [
    [
      "版・節目の表",
      "判断の待ち"
    ],
    [
      "Releases and milestones",
      "Pending decisions"
    ]
  ],
  "current-status": [
    [
      "今の版と状態",
      "直近で決めたこと",
      "次にやること",
      "止まっていること"
    ],
    [
      "Current version and status",
      "Recent decisions",
      "Next steps",
      "Blocked work"
    ]
  ],
  "scope": [
    [
      "対象",
      "対象外",
      "境界で判断が要るもの",
      "変更の手続き"
    ],
    [
      "In scope",
      "Out of scope",
      "Boundary decisions",
      "Change procedure"
    ]
  ],
  "project-plan": [
    [
      "進め方",
      "体制",
      "品質の確かめ方",
      "報告と会議体",
      "リスクの扱い",
      "変更の扱い"
    ],
    [
      "Approach",
      "Team",
      "Quality verification",
      "Reporting and meetings",
      "Risk management",
      "Change management"
    ]
  ],
  "communication-plan": [
    [
      "会議体の表",
      "連絡の手段"
    ],
    [
      "Meetings",
      "Communication channels"
    ]
  ],
  "meeting-minutes": [
    [
      "日時・参加者",
      "議題",
      "決まったこと",
      "宿題"
    ],
    [
      "Date and participants",
      "Agenda",
      "Decisions",
      "Action items"
    ]
  ],
  "sprint": [
    [
      "ゴール",
      "含むTicket",
      "レビューの結果",
      "振り返り"
    ],
    [
      "Goal",
      "Included tickets",
      "Review results",
      "Retrospective"
    ]
  ],
  "phase": [
    [
      "工程の目的",
      "成果物の一覧",
      "完了の判定の基準",
      "承認の表"
    ],
    [
      "Phase purpose",
      "Deliverables",
      "Completion criteria",
      "Approvals"
    ]
  ],
  "retrospective": [
    [
      "よかったこと",
      "困ったこと",
      "次に変えること"
    ],
    [
      "What went well",
      "What was difficult",
      "Changes for next time"
    ]
  ],
  "completion-handover": [
    [
      "目的の達成度",
      "成果物の一覧と場所",
      "残った作業",
      "運用の引継ぎ先と注意点"
    ],
    [
      "Achievement of objectives",
      "Deliverables and locations",
      "Remaining work",
      "Operations handover and cautions"
    ]
  ]
};
    expect(Object.keys(headings)).toHaveLength(14);
    const catalog = loadCatalog();
    for (const [id, [ja, en]] of Object.entries(headings)) {
      const template = catalog.templates.find(t => t.id === id);
      expect(template, id).toBeDefined();
      for (const heading of ja) expect(template!.body.ja).toContain(`## ${heading}\n`);
      for (const heading of en) expect(template!.body.en).toContain(`## ${heading}\n`);
      expect(template!.guideText?.ja).toBeTruthy();
      expect(template!.guideText?.en).toBeTruthy();
    }
  });
});
