import { STABLE_API_VERSION } from "@vellym-internal/core";

export type SetupLanguage = "ja" | "en";

/**
 * Hand written bodies for the repository-root guide pages. Every other page in
 * the pack uses the generated "purpose + blank fields" body from the locale
 * bundle; these four explain Vellym itself and need real prose.
 */
const guideBodies: Record<string, Record<SetupLanguage, string>> = {
  "project-guide": {
    ja: `## このページの役割

このページは、このフォルダから必要なPage YAMLを探すための入口です。
個別の要求、判断、進捗はここへ複製せず、それぞれのPageを確認します。

## 文書を探す順序

1. 製品やprojectの目的と境界を確認します。
2. 現在地、対象範囲、次に行う作業を確認します。
3. 対象の要求と、確定した設計判断を確認します。
4. 必要な画面仕様、計画、リスク、検証資料だけを追加で確認します。

最初から全Pageを読まず、title、文書種別、フォルダ、見出し、検索結果から候補を絞ります。
このPageは初期案なので、project固有の構成と読み順に合わせて編集できます。

## 情報が矛盾する場合

要求と確定した設計判断を、計画、デザイン案、調査記録より優先します。
矛盾を推測で解消せず、対象Pageと未決事項を確認します。`,
    en: `## Purpose of this page

This page is the entry point for finding the Page YAML files in this folder.
Do not copy individual requirements, decisions, or status here; open their Pages instead.

## Reading order

1. Check the product or project purpose and boundaries.
2. Check the current position, scope, and next work.
3. Check the relevant requirements and accepted design decisions.
4. Open only the screen specifications, plans, risks, and verification material the task needs.

Do not read every Page up front. Narrow candidates by title, document type, folder, heading, and search result.
This Page is an initial draft and can be edited to match the project-specific structure.

## Conflicting information

Prefer requirements and accepted design decisions over plans, design proposals, and research notes.
Do not resolve a conflict by guessing; identify the affected Pages and the open decision.`
  },
  "external-ai-document-guide": {
    ja: `## 外部AIエージェントから利用する

Vellymの管理対象は通常のYAMLファイルです。特定のAI製品やprompt形式には依存しません。

## 読み方

- 最初に共通入口があれば読み、情報の配置と読み順を確認します。
- title、\`metadata.labels\`、フォルダ、見出し、検索語から候補を絞ります。
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

- If a shared entry Page exists, read it first to learn the information layout and reading order.
- Narrow candidates by title, \`metadata.labels\`, folder, heading, and search term.
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
  locale: ja
  blocks:
    - id: body
      type: rich-text
      content: |
        ## 見出し

        本文をCommonMarkで記載します。
\`\`\`

## 編集時の注意

- \`metadata.name\`は小文字英数字とハイフンによる一意なIDです。作成後は原則変更しません。
- \`metadata.title\`は画面に表示する名前で、変更できます。
- \`metadata.slug\`、\`labels\`、\`annotations\`は必要な場合だけ指定します。
- YAMLのインデントとblockの\`id\`、\`type\`を保ちます。
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
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: |
        ## Heading

        Write the body in CommonMark.
\`\`\`

## Editing safely

- \`metadata.name\` is a unique lowercase alphanumeric and hyphen ID. Normally do not change it after creation.
- \`metadata.title\` is the displayed name and can be changed.
- Add \`metadata.slug\`, \`labels\`, and \`annotations\` only when needed.
- Preserve YAML indentation and each block's \`id\` and \`type\`.
- Do not remove unknown blocks or keys without understanding them.
- Run \`vellym validate\` after editing.
- Vellym never runs Git add, commit, or push automatically.`
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

export function guideBody(id: string, language: SetupLanguage): string | undefined {
  return guideBodies[id]?.[language];
}
