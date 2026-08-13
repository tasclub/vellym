import { createHash } from "node:crypto";
import { access, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { STABLE_API_VERSION, validatePage } from "@vellym-internal/core";
import { loadConfig } from "./config.js";
import { RuntimeError } from "./errors.js";
import { loadRepository } from "./repository.js";

export type SetupProfileId =
  | "minimal"
  | "software-basic"
  | "arc42"
  | "project-management"
  | "product-planning";
export type SetupLanguage = "ja" | "en";

export interface SetupTemplate {
  id: string;
  relativePath: string;
  pageId: string;
  title: string;
  documentType: string;
  heading: string;
  description: string;
  defaultSelected?: boolean;
  defaultFileName?: string;
  editableFileName?: boolean;
  titleEn?: string;
  headingEn?: string;
  descriptionEn?: string;
}

export interface SetupProfile {
  id: SetupProfileId;
  title: string;
  templateIds: string[];
}

const templates: SetupTemplate[] = [
  { id: "welcome", relativePath: "docs/content/welcome.yaml", pageId: "welcome", title: "Vellymへようこそ", documentType: "guide", heading: "はじめに", description: "このYAMLがVellymで表示・編集する文書の正本です。" },
  { id: "project-guide", relativePath: "docs/content/index.yaml", pageId: "project-guide", title: "プロジェクト文書の案内", documentType: "repository-guide", heading: "このページの役割", description: "管理対象文書の種類、正本の優先順位、必要な文書だけを読む方法を案内します。", defaultSelected: false, defaultFileName: "index.yaml", editableFileName: true },
  { id: "external-ai-document-guide", relativePath: "docs/content/ai-guide.yaml", pageId: "external-ai-document-guide", title: "外部AI向け文書利用ガイド", documentType: "guide", heading: "外部AIエージェントから利用する", description: "外部AIエージェントがYAMLから必要な正本を限定して読むための原則を案内します。", defaultSelected: false, defaultFileName: "ai-guide.yaml", editableFileName: true },
  { id: "yaml-editing-guide", relativePath: "docs/content/yaml-guide.yaml", pageId: "yaml-editing-guide", title: "YAML直接編集ガイド", documentType: "guide", heading: "YAMLを直接編集する", description: "Page YAMLの最小構造と、安全に直接編集して検証する方法を案内します。", defaultSelected: false, defaultFileName: "yaml-guide.yaml", editableFileName: true },
  { id: "project-charter", relativePath: "docs/content/project/プロジェクト憲章.yaml", pageId: "project-charter", title: "プロジェクト憲章", documentType: "project-charter", heading: "目的", description: "製品の目的、解決する課題、境界を記載します。" },
  { id: "requirements", relativePath: "docs/content/requirements/要求.yaml", pageId: "requirements", title: "要求", documentType: "requirement", heading: "要求", description: "利用者が必要とすることと受入条件を記載します。" },
  { id: "decision-log", relativePath: "docs/content/decisions/設計判断.yaml", pageId: "decision-log", title: "設計判断", documentType: "architecture-decision", heading: "決定", description: "重要な選択、その理由、影響を記載します。" },
  { id: "roadmap", relativePath: "docs/content/project-management/ロードマップ.yaml", pageId: "roadmap", title: "ロードマップ", documentType: "roadmap", heading: "ロードマップ", description: "提供段階と各段階の成果を記載します。" },
  { id: "risk-register", relativePath: "docs/content/project-management/リスク登録簿.yaml", pageId: "risk-register", title: "リスク登録簿", documentType: "risk-register", heading: "リスク", description: "主要なリスク、影響、対応を記載します。" },
  { id: "current-position", relativePath: "docs/content/project-management/現在地と次作業.yaml", pageId: "current-position-and-next-work", title: "現在地と次作業", documentType: "project-status", heading: "現在地", description: "現在の状態と次に行う作業を記載します。" },
  { id: "arc42-context", relativePath: "docs/content/architecture/コンテキストとスコープ.yaml", pageId: "architecture-context-and-scope", title: "コンテキストとスコープ", documentType: "architecture", heading: "コンテキストとスコープ", description: "対象システムと外部環境の境界を検討します。" },
  { id: "arc42-strategy", relativePath: "docs/content/architecture/ソリューション戦略.yaml", pageId: "architecture-solution-strategy", title: "ソリューション戦略", documentType: "architecture", heading: "ソリューション戦略", description: "主要な設計方針と技術上の方向を検討します。" },
  { id: "arc42-building-blocks", relativePath: "docs/content/architecture/ビルディングブロック.yaml", pageId: "architecture-building-blocks", title: "ビルディングブロック", documentType: "architecture", heading: "ビルディングブロック", description: "主要な構成要素と責務を検討します。" },
  { id: "arc42-runtime", relativePath: "docs/content/architecture/ランタイムビュー.yaml", pageId: "architecture-runtime-view", title: "ランタイムビュー", documentType: "architecture", heading: "ランタイムビュー", description: "重要な処理の流れと相互作用を検討します。" },
  { id: "stakeholders", relativePath: "docs/content/project-management/ステークホルダー.yaml", pageId: "project-stakeholders", title: "ステークホルダー", documentType: "stakeholder-register", heading: "ステークホルダー", description: "関係者、関心、関与方法を記載します。" },
  { id: "scope", relativePath: "docs/content/project-management/スコープ.yaml", pageId: "project-scope", title: "スコープ", documentType: "scope", heading: "スコープ", description: "対象範囲と対象外を記載します。" },
  { id: "schedule", relativePath: "docs/content/project-management/スケジュール.yaml", pageId: "project-schedule", title: "スケジュール", documentType: "schedule", heading: "スケジュール", description: "主要な節目と依存関係を記載します。" },
  { id: "product-vision", relativePath: "docs/content/product/プロダクトビジョン.yaml", pageId: "product-vision", title: "プロダクトビジョン", documentType: "product-vision", heading: "ビジョン", description: "誰のどの課題を、どのような状態へ変えるかを記載します。" },
  { id: "user-problem", relativePath: "docs/content/product/ユーザー課題.yaml", pageId: "user-problem", title: "ユーザー課題", documentType: "user-problem", heading: "ユーザーと課題", description: "対象ユーザー、状況、現在の代替手段、困りごとを記載します。" },
  { id: "product-hypotheses", relativePath: "docs/content/product/仮説.yaml", pageId: "product-hypotheses", title: "プロダクト仮説", documentType: "product-hypotheses", heading: "検証する仮説", description: "価値、利用、実現性に関する仮説と検証方法を記載します。" },
  { id: "release-plan", relativePath: "docs/content/product/リリース計画.yaml", pageId: "release-plan", title: "リリース計画", documentType: "release-plan", heading: "リリースの目的", description: "対象、提供内容、品質ゲート、告知、リリース後確認を記載します。" }
];

const defaultFolderNames: Record<SetupLanguage, Record<string, string>> = {
  ja: {
    project: "プロジェクト",
    requirements: "要求",
    decisions: "設計判断",
    architecture: "アーキテクチャ",
    "project-management": "プロジェクト管理",
    product: "プロダクト企画"
  },
  en: {
    project: "project",
    requirements: "requirements",
    decisions: "decisions",
    architecture: "architecture",
    "project-management": "project-management",
    product: "product"
  }
};

const english = new Map<string, Pick<SetupTemplate, "title" | "heading" | "description">>([
  ["welcome", { title: "Welcome to Vellym", heading: "Getting started", description: "Learn how to create, organize, edit, and store project documents." }],
  ["project-guide", { title: "Project document guide", heading: "Purpose of this page", description: "Learn the document roles, source-of-truth order, and how to read only what a task needs." }],
  ["external-ai-document-guide", { title: "Document guide for external AI agents", heading: "Using documents from an external AI agent", description: "Learn how an external AI agent should select and read the YAML sources of truth." }],
  ["yaml-editing-guide", { title: "Direct YAML editing guide", heading: "Editing YAML directly", description: "Learn the minimum Page YAML structure and how to edit and validate it safely." }],
  ["project-charter", { title: "Project charter", heading: "Purpose", description: "Describe the product purpose, problem, and boundaries." }],
  ["requirements", { title: "Requirements", heading: "Requirements", description: "Describe user needs and acceptance criteria." }],
  ["decision-log", { title: "Design decisions", heading: "Decision", description: "Record important choices, rationale, and consequences." }],
  ["roadmap", { title: "Roadmap", heading: "Roadmap", description: "Describe delivery stages and outcomes." }],
  ["risk-register", { title: "Risk register", heading: "Risks", description: "Record major risks, impact, and responses." }],
  ["current-position", { title: "Current position and next work", heading: "Current position", description: "Record the current state and next work." }],
  ["arc42-context", { title: "Context and scope", heading: "Context and scope", description: "Describe the system boundary and external environment." }],
  ["arc42-strategy", { title: "Solution strategy", heading: "Solution strategy", description: "Describe the major design and technology direction." }],
  ["arc42-building-blocks", { title: "Building blocks", heading: "Building blocks", description: "Describe the main components and responsibilities." }],
  ["arc42-runtime", { title: "Runtime view", heading: "Runtime view", description: "Describe important flows and interactions." }],
  ["stakeholders", { title: "Stakeholders", heading: "Stakeholders", description: "Record stakeholders, concerns, and engagement." }],
  ["scope", { title: "Scope", heading: "Scope", description: "Describe what is in and out of scope." }],
  ["schedule", { title: "Schedule", heading: "Schedule", description: "Record milestones and dependencies." }],
  ["product-vision", { title: "Product vision", heading: "Vision", description: "Describe whose problem the product solves and the outcome it creates." }],
  ["user-problem", { title: "User problem", heading: "User and problem", description: "Describe the target user, context, alternatives, and pain." }],
  ["product-hypotheses", { title: "Product hypotheses", heading: "Hypotheses to test", description: "Record value, usability, and feasibility hypotheses and how to test them." }],
  ["release-plan", { title: "Release plan", heading: "Release objective", description: "Record audience, deliverables, quality gates, announcement, and follow-up." }]
]);

const profiles: SetupProfile[] = [
  { id: "minimal", title: "最小構成", templateIds: ["welcome", "project-guide", "external-ai-document-guide", "yaml-editing-guide"] },
  { id: "software-basic", title: "ソフトウェア開発の基本", templateIds: ["welcome", "project-guide", "external-ai-document-guide", "yaml-editing-guide", "project-charter", "requirements", "decision-log", "roadmap", "risk-register", "current-position"] },
  { id: "arc42", title: "アーキテクチャ", templateIds: ["arc42-context", "arc42-strategy", "arc42-building-blocks", "arc42-runtime"] },
  { id: "project-management", title: "プロジェクト管理", templateIds: ["stakeholders", "scope", "schedule"] },
  { id: "product-planning", title: "プロダクト企画", templateIds: ["product-vision", "user-problem", "product-hypotheses", "requirements", "roadmap", "release-plan"] }
];

function configSource(contentRoot: string, language: SetupLanguage): string {
  return `schemaVersion: "1.0"\ncontentRoot: ${contentRoot}\noutputDir: dist/vellym\nui:\n  language: ${language}\nplugins: []\n`;
}
const templateById = new Map(templates.map((template) => [template.id, template]));
const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

export function setupProfiles(): SetupProfile[] {
  return profiles.map((profile) => ({ ...profile, templateIds: [...profile.templateIds] }));
}

export function setupManifest(): {
  profiles: SetupProfile[];
  templates: SetupTemplate[];
} {
  return {
    profiles: setupProfiles(),
    templates: templates.map((template) => ({ ...template }))
  };
}

const guideBodies: Record<string, Record<SetupLanguage, string>> = {
  "project-guide": {
    ja: `## このページの役割

このページは、このフォルダから必要な正本文書を探すための入口です。
個別の要求、判断、進捗はここへ複製せず、それぞれのPageを確認します。

## 文書を探す順序

1. 製品やprojectの目的と境界を確認します。
2. 現在地、対象範囲、次に行う作業を確認します。
3. 対象の要求と、確定した設計判断を確認します。
4. 必要な画面仕様、計画、リスク、検証資料だけを追加で確認します。

最初から全Pageを読まず、title、文書種別、フォルダ、見出し、検索結果から候補を絞ります。
このPageは初期案なので、project固有の正本と読み順に合わせて編集できます。

## 情報が矛盾する場合

要求と確定した設計判断を、計画、デザイン案、調査記録より優先します。
矛盾を推測で解消せず、対象Pageと未決事項を確認します。`,
    en: `## Purpose of this page

This page is the entry point for finding the sources of truth in this folder.
Do not copy individual requirements, decisions, or status here; open their Pages instead.

## Reading order

1. Check the product or project purpose and boundaries.
2. Check the current position, scope, and next work.
3. Check the relevant requirements and accepted design decisions.
4. Open only the screen specifications, plans, risks, and verification material the task needs.

Do not read every Page up front. Narrow candidates by title, document type, folder, heading, and search result.
This Page is an initial draft and can be edited to match the project-specific sources of truth.

## Conflicting information

Prefer requirements and accepted design decisions over plans, design proposals, and research notes.
Do not resolve a conflict by guessing; identify the affected Pages and the open decision.`
  },
  "external-ai-document-guide": {
    ja: `## 外部AIエージェントから利用する

Vellymの管理対象は通常のYAMLファイルです。特定のAI製品やprompt形式には依存しません。

## 読み方

- 最初に共通入口があれば読み、正本の種類と優先順位を確認します。
- title、\`spec.documentType\`、フォルダ、見出し、検索語から候補を絞ります。
- 候補を選んでから必要なPageまたは見出しだけを読みます。
- 完了済み計画、対象外の段階、生成物、無関係な調査記録を通常は読みません。
- 要求、確定した設計判断、計画、デザイン案、調査記録を区別します。

## 変更するとき

- YAMLの構造とCommonMark本文を保ち、変更後に\`vellym validate\`で検証します。
- 読み取れないPageや矛盾を、推測で修正しません。
- VellymはGitのadd、commit、pushを自動実行しません。`,
    en: `## Using documents from an external AI agent

Vellym manages ordinary YAML files. It does not depend on a particular AI product or prompt format.

## Reading

- If a shared entry Page exists, read it first to learn the source-of-truth roles and priority.
- Narrow candidates by title, \`spec.documentType\`, folder, heading, and search term.
- Read only the selected Page or headings after narrowing the candidates.
- Normally exclude completed plans, unrelated stages, generated output, and unrelated research notes.
- Distinguish requirements, accepted decisions, plans, design proposals, and research notes.

## Changing files

- Preserve the YAML structure and CommonMark body, then run \`vellym validate\`.
- Do not guess when a Page is unreadable or sources conflict.
- Vellym never runs Git add, commit, or push automatically.`
  },
  "yaml-editing-guide": {
    ja: `## YAMLを直接編集する

Pageは1ファイルに1件保存します。次は最小例です。

\`\`\`yaml
apiVersion: ${STABLE_API_VERSION}
kind: Page
metadata:
  name: example-page
  title: 文書タイトル
spec:
  documentType: guide
  locale: ja
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: |
        ## 見出し

        本文をCommonMarkで記載します。
\`\`\`

## 編集時の注意

- \`metadata.name\`は小文字英数字とハイフンによる一意なIDです。作成後は原則変更しません。
- \`metadata.title\`は画面に表示する名前で、変更できます。
- \`metadata.slug\`、\`labels\`、\`annotations\`は必要な場合だけ指定します。
- YAMLのインデントとblockの\`id\`、\`type\`、\`format\`を保ちます。
- 未知のblockや未知キーを、理解せずに削除しません。
- 編集後は\`vellym validate\`を実行します。
- VellymはGitのadd、commit、pushを自動実行しません。`,
    en: `## Editing YAML directly

Store one Page in each file. This is a minimal example.

\`\`\`yaml
apiVersion: ${STABLE_API_VERSION}
kind: Page
metadata:
  name: example-page
  title: Document title
spec:
  documentType: guide
  locale: en
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: |
        ## Heading

        Write the body in CommonMark.
\`\`\`

## Editing safely

- \`metadata.name\` is a unique lowercase alphanumeric and hyphen ID. Normally do not change it after creation.
- \`metadata.title\` is the displayed name and can be changed.
- Add \`metadata.slug\`, \`labels\`, and \`annotations\` only when needed.
- Preserve YAML indentation and each block's \`id\`, \`type\`, and \`format\`.
- Do not remove unknown blocks or keys without understanding them.
- Run \`vellym validate\` after editing.
- Vellym never runs Git add, commit, or push automatically.`
  },
  "product-vision": {
    ja: `## ビジョン

対象ユーザーが、現在のどの状態から、どの状態へ変わることを目指すかを一文で記載します。

## 対象ユーザー

- 主対象:
- 利用する状況:
- 今回は対象にしない利用者:

## 提供する価値

- 解決する課題:
- 現在の代替手段との違い:
- 成功したと判断できる変化:

## 境界

- 提供すること:
- 提供しないこと:

## 完了条件

対象ユーザー、解決する課題、目指す変化、対象外が矛盾なく説明できる。`,
    en: `## Vision

State in one sentence how the product changes the target user's current situation.

## Target user

- Primary audience:
- Usage context:
- Users not targeted now:

## Value

- Problem to solve:
- Difference from current alternatives:
- Observable successful outcome:

## Boundaries

- Included:
- Not included:

## Completion criteria

The audience, problem, intended outcome, and exclusions can be explained consistently.`
  },
  "user-problem": {
    ja: `## ユーザーと状況

- 対象ユーザー:
- 課題が発生する状況:
- 達成しようとしていること:

## 現在の課題

- 困っていること:
- 発生頻度と影響:
- 現在の代替手段:
- 代替手段が不十分な理由:

## 根拠

観察、問い合わせ、利用記録など、課題が実在すると判断した根拠を記載します。

## 未確認事項

推測と確認済み事実を分け、次に確認する事項を記載します。

## 完了条件

解決策を前提にせず、ユーザー、状況、課題、根拠が具体化されている。`,
    en: `## User and context

- Target user:
- Situation where the problem occurs:
- Job they are trying to complete:

## Current problem

- Pain:
- Frequency and impact:
- Current alternative:
- Why the alternative is insufficient:

## Evidence

Record observations, requests, or usage evidence showing that the problem exists.

## Unknowns

Separate assumptions from confirmed facts and state what to investigate next.

## Completion criteria

The user, context, problem, and evidence are concrete without assuming a solution.`
  },
  "product-hypotheses": {
    ja: `## 検証する仮説

| ID | 仮説 | 根拠 | 検証方法 | 成功条件 | 状態 |
| --- | --- | --- | --- | --- | --- |
| H-001 |  |  |  |  | 未検証 |

## 優先順位

失敗した場合に計画へ最も大きく影響する仮説から検証します。

## 検証結果

実施日、対象、観察結果、判断、次の対応を記載します。結果に合わせて仮説を更新し、過去の判断を黙って書き換えません。

## 完了条件

各仮説に検証方法と判定可能な成功条件があり、未検証と確認済みが区別されている。`,
    en: `## Hypotheses to test

| ID | Hypothesis | Evidence | Test | Success condition | Status |
| --- | --- | --- | --- | --- | --- |
| H-001 |  |  |  |  | Untested |

## Priority

Test hypotheses whose failure would have the largest effect on the plan first.

## Results

Record the date, audience, observations, decision, and next action. Update hypotheses from evidence without silently rewriting prior decisions.

## Completion criteria

Every hypothesis has a test and decidable success condition, and untested items are distinct from confirmed findings.`
  },
  "release-plan": {
    ja: `## リリースの目的

- 対象ユーザー:
- このリリースで確認すること:
- リリースしない場合の判断条件:

## 提供内容

- 追加・変更:
- 対象外:
- 既知の制約:

## 品質ゲート

- 自動検証:
- 手動受入:
- リリースを止める不具合:
- 互換性とmigration:

## 配布と告知

- versionと配布先:
- 導入手順:
- 告知先:
- 問い合わせ・不具合報告先:

## リリース後

確認期間、監視項目、問題発生時の対応、次版へ送る項目を記載します。

## 完了条件

対象、変更、品質ゲート、配布、告知、リリース後対応が担当者なしでも追跡できる。`,
    en: `## Release objective

- Target audience:
- What this release validates:
- Conditions for not releasing:

## Deliverables

- Added or changed:
- Excluded:
- Known limitations:

## Quality gates

- Automated verification:
- Manual acceptance:
- Release-blocking defects:
- Compatibility and migration:

## Distribution and announcement

- Version and channels:
- Installation:
- Announcement channels:
- Support and bug reports:

## After release

Record the observation period, signals, incident response, and work deferred to the next release.

## Completion criteria

The audience, changes, gates, distribution, announcement, and follow-up are independently traceable.`
  }
};

function guideBody(id: string, language: SetupLanguage): string | undefined {
  return guideBodies[id]?.[language];
}

function pageSource(
  template: SetupTemplate,
  pageId: string,
  slug: string,
  language: SetupLanguage
): string {
  const text = language === "en" ? english.get(template.id) : undefined;
  const title = text?.title ?? template.title;
  const heading = text?.heading ?? template.heading;
  const description = template.id === "welcome"
    ? language === "en"
      ? "Create pages from the plus button in the document tree, edit a page with Edit, and change storage under Settings. Vellym writes ordinary YAML files and never commits them automatically."
      : "文書ツリーの「＋」からページを作成し、「編集」で内容を変更できます。保存先は設定から変更できます。Vellymは通常のYAMLファイルへ保存し、自動でcommitしません。"
    : text?.description ?? template.description;
  const body = guideBody(template.id, language) ?? `## ${heading}\n\n${description}`;
  return `apiVersion: ${STABLE_API_VERSION}\nkind: Page\nmetadata:\n  name: ${pageId}\n  slug: ${slug}\n  title: ${title}\nspec:\n  documentType: ${template.documentType}\n  locale: ${language}\n  blocks:\n    - id: body\n      type: rich-text\n      format: commonmark\n      content: |\n${body.split("\n").map((line) => `        ${line}`).join("\n")}\n`;
}

export interface SetupPlan {
  profiles: SetupProfileId[];
  selectedTemplateIds: string[];
  conflictResolutions: Record<string, "skip" | "alternate">;
  projectRoot: string;
  contentRoot: string;
  language: SetupLanguage;
  folderNames: Record<string, string>;
  pageFileNames: Record<string, string>;
  files: Array<{
    relativePath: string;
    templateId?: string;
    pageId?: string;
    slug?: string;
    title: string;
    status: "create" | "conflict" | "skip";
    conflictReason?: "path" | "page-id";
  }>;
  planHash: string;
}

function safeRelativeRoot(value: string): string {
  const normalized = value.normalize("NFC").replace(/\/+$/g, "");
  if (
    !normalized ||
    normalized === "." ||
    path.isAbsolute(normalized) ||
    normalized.includes("\\") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new RuntimeError("contentRootはプロジェクト内の相対pathで指定してください", 400, "CONTENT_ROOT");
  }
  return normalized;
}

function safeFolderNames(
  language: SetupLanguage,
  values: Record<string, string> | undefined
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(defaultFolderNames[language]).map(([logical, fallback]) => {
      const value = (values?.[logical] ?? fallback).normalize("NFC").trim();
      if (
        !value ||
        value === "." ||
        value === ".." ||
        value.startsWith(".") ||
        value === "_archive" ||
        /[\/\\\0]/.test(value)
      ) {
        throw new RuntimeError(
          `フォルダ名が不正です: ${logical}`,
          400,
          "SETUP_FOLDER_NAME"
        );
      }
      return [logical, value];
    })
  );
}

function safePageFileNames(
  values: Record<string, string> | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [templateId, raw] of Object.entries(values ?? {})) {
    const template = templateById.get(templateId);
    if (!template?.editableFileName) {
      throw new RuntimeError(
        `ファイル名を変更できないtemplateです: ${templateId}`,
        400,
        "SETUP_FILE_NAME"
      );
    }
    const value = raw.normalize("NFC").trim();
    if (
      !value ||
      value.startsWith(".") ||
      value.toLocaleLowerCase() === "_index.yaml" ||
      !/\.ya?ml$/i.test(value) ||
      /[\/\\\0]/.test(value) ||
      value.length > 200
    ) {
      throw new RuntimeError(
        `初期Pageのファイル名が不正です: ${templateId}`,
        400,
        "SETUP_FILE_NAME"
      );
    }
    result[templateId] = value;
  }
  return result;
}

function slugFromTitle(title: string): string {
  return title
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "page";
}

function outputPath(
  template: SetupTemplate,
  contentRoot: string,
  language: SetupLanguage,
  folderNames: Record<string, string>,
  pageFileNames: Record<string, string>
): string {
  const relative = template.relativePath.replace(/^docs\/content\//, "");
  const parts = relative.split("/");
  const filename = parts.pop()!;
  const folders = parts.map(
    (part) => folderNames[part] ?? defaultFolderNames[language][part] ?? part
  );
  const localizedFilename =
    pageFileNames[template.id] ??
    template.defaultFileName ??
    (language === "en"
      ? `${template.id}.yaml`
      : template.id === "welcome"
        ? "ようこそ.yaml"
        : filename);
  return path.posix.join(contentRoot, ...folders, localizedFilename);
}

function folderSource(title: string, order: string[]): string {
  const orderSource = order.length
    ? `\n${order.map((item) => `    - ${item}`).join("\n")}`
    : " []";
  return `apiVersion: ${STABLE_API_VERSION}\nkind: Folder\nmetadata:\n  title: ${title}\nspec:\n  order:${orderSource}\n`;
}

function rootChildrenForPlan(plan: SetupPlan): string[] {
  const prefix = `${plan.contentRoot}/`;
  const pagePaths = plan.files
    .filter((file) => file.templateId)
    .map((file) => file.relativePath.slice(prefix.length));
  const directPages = pagePaths
    .filter((relative) => !relative.includes("/"))
    .map((relative) => path.posix.basename(relative));
  const folders = [
    "project",
    "requirements",
    "decisions",
    "architecture",
    "project-management",
    "product"
  ]
    .map((logical) => plan.folderNames[logical])
    .filter((folder): folder is string =>
      Boolean(folder) && pagePaths.some((relative) => relative.startsWith(`${folder}/`))
    );
  return [...directPages, ...folders];
}

async function exists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch { return false; }
}

function selection(
  profileIds: SetupProfileId[],
  selectedTemplateIds?: string[]
): SetupTemplate[] {
  if (!profileIds.length) throw new RuntimeError("profileを指定してください", 400, "SETUP_PROFILE");
  const available = new Set<string>();
  for (const id of profileIds) {
    const profile = profileById.get(id);
    if (!profile) throw new RuntimeError(`不明なprofileです: ${id}`, 400, "SETUP_PROFILE");
    profile.templateIds.forEach((templateId) => available.add(templateId));
  }
  const selected =
    selectedTemplateIds ??
    [...available].filter(
      (templateId) => templateById.get(templateId)?.defaultSelected !== false
    );
  for (const id of selected) {
    if (!available.has(id)) throw new RuntimeError(`profileにない文書です: ${id}`, 400, "SETUP_TEMPLATE");
  }
  return [...new Set(selected)].map((id) => templateById.get(id)!);
}

export async function planProjectSetup(
  projectRoot: string,
  options: {
    profiles?: SetupProfileId[];
    selectedTemplateIds?: string[];
    conflictResolutions?: Record<string, "skip" | "alternate">;
    contentRoot?: string;
    language?: SetupLanguage;
    folderNames?: Record<string, string>;
    pageFileNames?: Record<string, string>;
  } = {}
): Promise<SetupPlan> {
  const root = path.resolve(projectRoot);
  const profileIds = options.profiles ?? ["minimal"];
  const language = options.language ?? "ja";
  const relativeContentRoot = safeRelativeRoot(options.contentRoot ?? "docs");
  const folderNames = safeFolderNames(language, options.folderNames);
  const pageFileNames = safePageFileNames(options.pageFileNames);
  const selected = selection(profileIds, options.selectedTemplateIds);
  const conflictResolutions = { ...(options.conflictResolutions ?? {}) };
  const files: SetupPlan["files"] = [];
  const contentRoot = path.join(root, relativeContentRoot);
  const existing = (await exists(contentRoot))
    ? await loadRepository(contentRoot)
    : undefined;
  const existingPageIds = new Set(existing?.byName.keys() ?? []);
  const existingSlugs = new Set(existing?.bySlug.keys() ?? []);
  const plannedPaths = new Set<string>();
  for (const template of selected) {
    const relativePath = outputPath(
      template,
      relativeContentRoot,
      language,
      folderNames,
      pageFileNames
    );
    const pathKey = relativePath.normalize("NFC").toLocaleLowerCase();
    if (plannedPaths.has(pathKey)) {
      throw new RuntimeError(
        `初期Pageのファイル名が重複しています: ${relativePath}`,
        400,
        "SETUP_FILE_NAME"
      );
    }
    plannedPaths.add(pathKey);
    const target = path.join(root, relativePath);
    const pageId = `page-${createHash("sha256")
      .update(`${root}:${relativePath}`)
      .digest("hex")
      .slice(0, 24)}`;
    const localizedTitle =
      language === "en" ? english.get(template.id)?.title ?? template.title : template.title;
    let slug = slugFromTitle(localizedTitle);
    let slugSuffix = 2;
    while (
      existingSlugs.has(slug.toLocaleLowerCase()) ||
      files.some((file) => file.slug?.toLocaleLowerCase() === slug.toLocaleLowerCase())
    ) {
      slug = `${slugFromTitle(localizedTitle)}-${slugSuffix++}`;
    }
    const pathConflict = await exists(target);
    const pageIdConflict = existingPageIds.has(pageId);
    if (!pathConflict && !pageIdConflict) {
      files.push({
        relativePath,
        templateId: template.id,
        pageId,
        slug,
        title: localizedTitle,
        status: "create"
      });
      continue;
    }
    const resolution = conflictResolutions[template.id];
    if (resolution === "skip") {
      files.push({
        relativePath,
        templateId: template.id,
        pageId,
        slug,
        title: localizedTitle,
        status: "skip",
        conflictReason: pageIdConflict ? "page-id" : "path"
      });
      continue;
    }
    if (resolution === "alternate" && !pageIdConflict) {
      const extension = path.extname(relativePath);
      const alternateBasename = relativePath.slice(0, -extension.length);
      let suffix = 2;
      let alternatePath = `${alternateBasename}-${suffix}${extension}`;
      while (await exists(path.join(root, alternatePath))) {
        suffix += 1;
        alternatePath = `${alternateBasename}-${suffix}${extension}`;
      }
      files.push({
        relativePath: alternatePath,
        templateId: template.id,
        pageId,
        slug,
        title: localizedTitle,
        status: "create"
      });
      continue;
    }
    files.push({
      relativePath,
      templateId: template.id,
      pageId,
      slug,
      title: localizedTitle,
      status: "conflict",
      conflictReason: pageIdConflict ? "page-id" : "path"
    });
  }
  files.push({
    relativePath: path.posix.join(relativeContentRoot, "_index.yaml"),
    title: "Vellym root order",
    status: (await exists(path.join(root, relativeContentRoot, "_index.yaml"))) ? "conflict" : "create"
  });
  files.push({
    relativePath: "vellym.config.yaml",
    title: "Vellym設定",
    status: (await exists(path.join(root, "vellym.config.yaml")))
      ? "conflict"
      : "create"
  });
  const selectedIds = selected.map((template) => template.id);
  const planHash = createHash("sha256")
    .update(
      JSON.stringify({
        profiles: profileIds,
        selectedTemplateIds: selectedIds,
        conflictResolutions,
        projectRoot: root,
        contentRoot: relativeContentRoot,
        language,
        folderNames,
        pageFileNames,
        files
      })
    )
    .digest("hex");
  return {
    profiles: profileIds,
    selectedTemplateIds: selectedIds,
    conflictResolutions,
    projectRoot: root,
    contentRoot: relativeContentRoot,
    language,
    folderNames,
    pageFileNames,
    files,
    planHash
  };
}

export async function applyProjectSetup(expected: SetupPlan): Promise<void> {
  const current = await planProjectSetup(expected.projectRoot, {
    profiles: expected.profiles,
    selectedTemplateIds: expected.selectedTemplateIds,
    conflictResolutions: expected.conflictResolutions,
    contentRoot: expected.contentRoot,
    language: expected.language,
    folderNames: expected.folderNames,
    pageFileNames: expected.pageFileNames
  });
  if (current.planHash !== expected.planHash) throw new RuntimeError("preview後に対象が変更されました。もう一度確認してください", 409, "SETUP_PLAN_CONFLICT");
  const conflicts = current.files.filter((file) => file.status === "conflict");
  if (conflicts.length) throw new RuntimeError(`既存ファイルと競合しています: ${conflicts.map((file) => file.relativePath).join("、")}`, 409, "SETUP_FILE_CONFLICT");

  const createdCandidates = current.files.filter(
    (file) => file.status === "create"
  );
  const sources = new Map(
    createdCandidates.map((file) => [
      file.relativePath,
      file.templateId
        ? pageSource(
            templateById.get(file.templateId)!,
            file.pageId!,
            file.slug!,
            current.language
          )
        : file.relativePath.endsWith("_index.yaml")
          ? folderSource(
              current.language === "ja" ? "文書" : "Documents",
              rootChildrenForPlan(current)
            )
          : configSource(current.contentRoot, current.language)
    ])
  );
  for (const file of createdCandidates) {
    if (!file.templateId) continue;
    const document = parseDocument(sources.get(file.relativePath)!);
    if (
      document.errors.length ||
      !validatePage(document.toJS(), file.relativePath).page
    ) {
      throw new RuntimeError(
        "初期Pageの検証に失敗しました",
        500,
        "SETUP_VALIDATION"
      );
    }
  }
  const createdFiles: string[] = [];
  const createdDirectories: string[] = [];
  try {
    const directories = [
      ...new Set(
        createdCandidates.map((file) =>
          path.dirname(path.join(current.projectRoot, file.relativePath))
        )
      )
    ].sort((a, b) => a.length - b.length);
    const ensureDirectory = async (directory: string): Promise<void> => {
      if (await exists(directory)) return;
      const parent = path.dirname(directory);
      if (parent !== directory) await ensureDirectory(parent);
      try {
        await mkdir(directory);
        createdDirectories.push(directory);
      } catch (error) {
        if (!(await exists(directory))) throw error;
      }
    };
    for (const directory of directories) {
      await ensureDirectory(directory);
    }
    const ordered = [...createdCandidates].sort(
      (a, b) =>
        Number(a.relativePath === "vellym.config.yaml") -
        Number(b.relativePath === "vellym.config.yaml")
    );
    for (const file of ordered) {
      const target = path.join(current.projectRoot, file.relativePath);
      await writeFile(target, sources.get(file.relativePath)!, {
        encoding: "utf8",
        flag: "wx"
      });
      createdFiles.push(target);
    }
    await loadConfig(path.join(current.projectRoot, "vellym.config.yaml"));
  } catch (error) {
    const rollback = await Promise.allSettled(
      createdFiles.map((target) => rm(target, { force: true }))
    );
    for (const directory of createdDirectories.reverse()) {
      try { await rmdir(directory); } catch { /* Preserve non-empty directories. */ }
    }
    const remaining = rollback
      .map((result, index) =>
        result.status === "rejected"
          ? path.relative(current.projectRoot, createdFiles[index]!)
          : undefined
      )
      .filter((item): item is string => Boolean(item));
    if (remaining.length) {
      throw new RuntimeError(
        `初期化に失敗し、作成済みファイルを戻せませんでした: ${remaining.join("、")}`,
        500,
        "SETUP_ROLLBACK"
      );
    }
    throw error;
  }
}
