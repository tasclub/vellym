// CLIの表示文言を日本語・英語で切り替えるための軽量なメッセージ表。
// --language／ui.languageに応じて同じフラグで日英どちらの出力も得られる。
// initは管理ルートと構成の型からフォルダの枠と入口を作る。

import { OFFICIAL_PLUGINS } from "./version.js";

export type CliLanguage = "ja" | "en";

const officialPluginList = (): string => Object.keys(OFFICIAL_PLUGINS).join(",");

export interface CliMessages {
  usage(): string;
  initHelp(): string;
  initRemoved(option: string): string;
  addHelp(): string;
  devHelp(): string;
  validateHelp(): string;
  listHelp(): string;
  listKindRequired(): string;
  listKindInvalid(kind: string, available: string[]): string;
  listWhereInvalid(): string;
  listSummary(count: number): string;
  schemaHelp(): string;
  schemaKindRequired(): string;
  schemaKindInvalid(kind: string, available: string[]): string;
  schemaPluginsMissing(): string;
  schemaKindUnresolved(kind: string, packages: string[]): string;
  schemaModeInvalid(): string;
  buildHelp(): string;
  migrateHelp(): string;
  diagnosticLabel(severity: "error" | "warning"): string;
  optionNeedsValue(name: string): string;
  validateSummary(pages: number, diagnostics: number): string;
  hostInvalid(): string;
  externalBindWarning(): string;
  configMissing(url: string): string;
  configUnreadable(url: string): string;
  configCandidates(candidates: string[]): string;
  portInvalid(): string;
  languageInvalid(): string;
  unknownCommand(command: string): string;
  initCancelled(): string;
  initUnknownPlugin(name: string, available: readonly string[]): string;
  initComplete(target: string, created: number, skipped: number): string;
  initNext(): string;
  initLinks(): string;
  initGuides(): string;
  initAgentGuide(contentRoot: string): string;
  initPackageJsonUnreadable(): string;
  initPlan(target: string, create: string[], skip: string[], update: string[]): string;
  migrationTargetInvalid(): string;
  migrationPlanSummary(files: number, diagnostics: number): string;
  migrationSummary(files: number): string;
}

const ja: CliMessages = {
  usage: () => `Vellym

Usage:
  vellym init [project root] [--root docs|vellym|.] [--structure by-type|by-phase|by-feature]
  vellym add template|set <id> [options]
  vellym dev [--config <path>] [--host <address>] [--port <number>]
  vellym validate [--config <path>] [--json] [--strict]
  vellym list --kind <kind> [--where <key>=<value>]... [--json] [--config <path>] [--language ja|en]
  vellym schema --kind <kind> [--config <path>] [--language ja|en]
  vellym schema --list [--config <path>] [--language ja|en]
  vellym build [--config <path>] [--json]
  vellym migrate --to v1 [--config <path>] [--plan] [--json]

コマンド別の詳しい説明・例は「vellym <command> --help」で確認できます。

利用ガイド: https://vellym.tasclub.com/
AI向け案内: https://vellym.tasclub.com/llms.txt
スキーマ一覧: vellym schema --list
`,
  addHelp: () => `vellym add template|set <id> [--folder <path>] [--name <名前>]
vellym add --list [template|set]

--guide / --no-guide: VELLYM.mdへ追記するか（既定は追記しない）
--dry-run: 計画だけ表示  --json: JSON出力  --config <path>: 設定
プラグインのテンプレートは <プラグインID>:<ID> と --folder を指定します。
`,
  initRemoved: (option) => `${option}は廃止しました。新しい引数の例: vellym init my-project --root docs --structure by-type --language ja`,
  initHelp: () => `vellym init [project root] [options]

引数無しでdocs/に種類別・番号なしのフォルダの枠と入口を作ります。

Options:
  --root <value>        docs | vellym | .（管理ルート。既定: docs）
  --structure <value>   by-type | by-phase | by-feature（既定: by-type）
  --numbered / --no-numbered  番号の有無（既定: 工程別はあり、他はなし）
  --with-guide-folders  利用者向けのフォルダを追加
  --language <ja|en>    初期生成言語（既定: LC_ALL・LC_MESSAGES・LANG。日本語以外は英語）
  --plugins <list>      ${officialPluginList()}（任意）
  --dry-run            作成・skip・更新するファイルを表示し、何も書かない
  --json               計画をJSONで表示

例:
  vellym init ./my-docs --root docs --structure by-type --language ja
`,
  devHelp: () => `vellym dev [options]

開発サーバを起動します。

Options:
  --config <path>    設定ファイルpath（既定: vellym.config.yaml）
  --host <address>   127.0.0.1 または 0.0.0.0（既定: 127.0.0.1）
  --port <number>    1〜65535（既定: 4173）

例:
  vellym dev --port 5000
`,
  validateHelp: () => `vellym validate [options]

content root内のYAMLを検証し、診断を表示します。

Options:
  --config <path>    設定ファイルpath（既定: vellym.config.yaml）
  --json             機械可読なJSONで出力（各診断の詳細を含む）
  --strict           警告も終了コード1にする

通常はエラーがあれば終了コード1、それ以外は0です。--strictでは警告も対象です。

例:
  vellym validate
  vellym validate --json
  vellym validate --strict --json  # AI・CI向け
`,
  listHelp: () => `vellym list --kind <kind> [--where <key>=<value>]... [--json] [--config <path>] [--language ja|en]

索引行を読み取り専用で一覧します。--whereは完全一致、複数指定はANDです。
--jsonは診断を含むJSONを出力します。
`,
  schemaHelp: () => `vellym schema --kind <kind> [--config <path>] [--language ja|en]
vellym schema --list [--config <path>] [--language ja|en]

インストール済みのkindのJSON Schemaを出力します。kind指定時はJSON Schemaそのものを標準出力へ出します。
--listはkindを一覧します。--configを省略するとCoreのkindだけを扱います。
`,
  listKindRequired: () => "--kindを指定してください",
  listKindInvalid: (kind, available) => `不明なkind: ${kind}。指定可能: ${available.join(", ")}`,
  listWhereInvalid: () => "--whereはkey=valueで指定してください",
  listSummary: (count) => `${count}件`,
  schemaKindRequired: () => "--kindまたは--listを指定してください",
  schemaKindInvalid: (kind, available) => `不明なkind: ${kind}。指定可能: ${available.join(", ")}`,
  schemaPluginsMissing: () => "プラグインを読み込めないため、そのkindは一覧にありません。プロジェクトで`npm install`を実行してから、もう一度試してください。",
  schemaKindUnresolved: (kind, packages) => `${kind}は見つかりません。読み込めないプラグインがあります: ${packages.join(", ")}`,
  schemaModeInvalid: () => "--listと--kindは同時に指定できません",
  buildHelp: () => `vellym build [options]

静的サイトを生成します。

Options:
  --config <path>    設定ファイルpath（既定: vellym.config.yaml）
  --json             機械可読なJSONで出力

例:
  vellym build
`,
  migrateHelp: () => `vellym migrate --to v1 [options]

Page／FolderのapiVersionをv1へ明示的に移行します。

Options:
  --to v1           移行先（必須）
  --config <path>   設定ファイルpath（既定: vellym.config.yaml）
  --plan            変更予定の確認のみ（ファイルを変更しない）
  --json            機械可読なJSONで出力

先にvellym migrate --to v1 --planを実行し、Gitでcommitしてから適用してください。
`,
  diagnosticLabel: (severity) => (severity === "error" ? "エラー" : "警告"),
  optionNeedsValue: (name) => `${name}に値が必要です`,
  validateSummary: (pages, diagnostics) =>
    `検証結果: ${pages}ページ、診断${diagnostics}件`,
  hostInvalid: () => "--hostは127.0.0.1または0.0.0.0を指定してください",
  externalBindWarning: () =>
    "警告: 外部bind(0.0.0.0)で起動しました。Vellymに認証はなく、到達できる相手は文書の閲覧・編集・構成変更ができます。信頼できるネットワークだけで使用してください。",
  configMissing: (url) => `設定ファイルがありません。ブラウザで初期セットアップを開いてください: ${url}`,
  configUnreadable: (url) => `設定ファイルを読み込めません。ブラウザで理由を確認できます: ${url}`,
  configCandidates: (candidates) => `設定ファイルが複数見つかりました:\n${candidates.map((candidate) => `  ${candidate}`).join("\n")}\n--configで使用するファイルを指定してください。`,
  portInvalid: () => "--portは1から65535の整数で指定してください",
  languageInvalid: () => "--languageはjaまたはenを指定してください",
  unknownCommand: (command) => `不明なコマンドです: ${command}`,
  initCancelled: () => "初期化をキャンセルしました",
  initUnknownPlugin: (name, available) => `不明なプラグイン: ${name} (${available.join(", ")})`,
  initComplete: (target, created, skipped) => `初期化しました: ${target}\n作成: ${created}件、skip: ${skipped}件`,
  initNext: () => "次のコマンド:",
  initLinks: () => "利用ガイド: https://vellym.tasclub.com/\nAI向け案内: https://vellym.tasclub.com/llms.txt",
  initGuides: () => "プラグインの使い方:",
  initAgentGuide: (root) => `AGENTS.mdに次の1行を追加してください:\n作業前に${root === "." ? "" : `${root}/`}VELLYM.mdを読んでください。`,
  initPackageJsonUnreadable: () => "注意: package.jsonがJSONとして読めません。変更していないので、手で直してください。",
  initPlan: (target, create, skip, update) => [
    `初期化の計画（何も書いていません）: ${target}`,
    `作成: ${create.length}件、skip: ${skip.length}件、更新: ${update.length}件`,
    ...create.map((file) => `create: ${file}`),
    ...skip.map((file) => `skip: ${file}`),
    ...update.map((file) => `update: ${file}`)
  ].join("\n"),
  migrationTargetInvalid: () => "--to v1を指定してください",
  migrationPlanSummary: (files, diagnostics) =>
    `migration予定: ${files}ファイル、診断${diagnostics}件`,
  migrationSummary: (files) => `migration完了: ${files}ファイル`
};

const en: CliMessages = {
  usage: () => `Vellym

Usage:
  vellym init [project root] [--root docs|vellym|.] [--structure by-type|by-phase|by-feature]
  vellym add template|set <id> [options]
  vellym dev [--config <path>] [--host <address>] [--port <number>]
  vellym validate [--config <path>] [--json] [--strict]
  vellym list --kind <kind> [--where <key>=<value>]... [--json] [--config <path>] [--language ja|en]
  vellym schema --kind <kind> [--config <path>] [--language ja|en]
  vellym schema --list [--config <path>] [--language ja|en]
  vellym build [--config <path>] [--json]
  vellym migrate --to v1 [--config <path>] [--plan] [--json]

Run "vellym <command> --help" for per-command details and examples.

User guide: https://vellym.tasclub.com/en/
AI guide: https://vellym.tasclub.com/llms.txt
List schemas: vellym schema --list
`,
  addHelp: () => `vellym add template|set <id> [--folder <path>] [--name <name>]
vellym add --list [template|set]

--guide / --no-guide: append to VELLYM.md (default: no append)
--dry-run: preview only  --json: JSON output  --config <path>: configuration
For plugin templates use <plugin-id>:<id> and --folder.
`,
  initRemoved: (option) => `${option} has been removed. New arguments example: vellym init my-project --root docs --structure by-type --language en`,
  initHelp: () => `vellym init [project root] [options]

With no arguments, creates a by-type folder skeleton and entry page in docs/, without numbering.

Options:
  --root <value>        docs | vellym | . (management root; default: docs)
  --structure <value>   by-type | by-phase | by-feature (default: by-type)
  --numbered / --no-numbered  Number folders (default: on for by-phase, off otherwise)
  --with-guide-folders  Add user guide folders
  --language <ja|en>    Document language (default: LC_ALL, LC_MESSAGES, LANG; English unless Japanese)
  --plugins <list>      ${officialPluginList()} (optional)
  --dry-run            List files to create, skip, or update, and write nothing
  --json               Print the plan as JSON

Examples:
  vellym init ./my-docs --root docs --structure by-type --language en
`,
  devHelp: () => `vellym dev [options]

Starts the development server.

Options:
  --config <path>    Config file path (default: vellym.config.yaml)
  --host <address>   127.0.0.1 or 0.0.0.0 (default: 127.0.0.1)
  --port <number>    1-65535 (default: 4173)

Examples:
  vellym dev --port 5000
`,
  validateHelp: () => `vellym validate [options]

Validates the YAML under the content root and reports diagnostics.

Options:
  --config <path>    Config file path (default: vellym.config.yaml)
  --json             Emit machine-readable JSON (includes each diagnostic's details)
  --strict           Exit 1 for warnings as well

Normally exits 1 for errors and 0 otherwise. With --strict, warnings also cause exit 1.

Examples:
  vellym validate
  vellym validate --json
  vellym validate --strict --json  # For AI and CI
`,
  listHelp: () => `vellym list --kind <kind> [--where <key>=<value>]... [--json] [--config <path>] [--language ja|en]

List index rows without modifying resources. --where matches exactly; repeated filters use AND.
--json emits JSON including diagnostics.
`,
  schemaHelp: () => `vellym schema --kind <kind> [--config <path>] [--language ja|en]
vellym schema --list [--config <path>] [--language ja|en]

Prints the installed JSON Schema for a kind. With --kind, stdout contains the JSON Schema itself.
--list prints available kinds. Without --config, only Core kinds are available.
`,
  listKindRequired: () => "--kind is required",
  listKindInvalid: (kind, available) => `Unknown kind: ${kind}. Available: ${available.join(", ")}`,
  listWhereInvalid: () => "--where must be key=value",
  listSummary: (count) => `${count} row(s)`,
  schemaKindRequired: () => "Specify --kind or --list",
  schemaKindInvalid: (kind, available) => `Unknown kind: ${kind}. Available: ${available.join(", ")}`,
  schemaPluginsMissing: () => "Kinds from plugins that could not be loaded are missing. Run `npm install` in the project, then try again.",
  schemaKindUnresolved: (kind, packages) => `${kind} was not found. Plugins could not be loaded: ${packages.join(", ")}`,
  schemaModeInvalid: () => "--list and --kind cannot be used together",
  buildHelp: () => `vellym build [options]

Builds the static site.

Options:
  --config <path>    Config file path (default: vellym.config.yaml)
  --json             Emit machine-readable JSON

Examples:
  vellym build
`,
  migrateHelp: () => `vellym migrate --to v1 [options]

Explicitly migrates Page and Folder apiVersion values to v1.

Options:
  --to v1           Migration target (required)
  --config <path>   Config file path (default: vellym.config.yaml)
  --plan            Preview changes without writing files
  --json            Emit machine-readable JSON

Run vellym migrate --to v1 --plan first and commit your work before applying it.
`,
  diagnosticLabel: (severity) => (severity === "error" ? "error" : "warning"),
  optionNeedsValue: (name) => `${name} requires a value`,
  validateSummary: (pages, diagnostics) =>
    `Validation: ${pages} page(s), ${diagnostics} diagnostic(s)`,
  hostInvalid: () => "--host must be 127.0.0.1 or 0.0.0.0",
  externalBindWarning: () =>
    "Warning: started with an external bind (0.0.0.0). Vellym has no authentication, so anyone who can reach this address can read, edit, and restructure your documents. Use it only on a trusted network.",
  configMissing: (url) => `Configuration file not found. Open initial setup in your browser: ${url}`,
  configUnreadable: (url) => `Could not read the configuration file. See the reason in your browser: ${url}`,
  configCandidates: (candidates) => `Multiple configuration files were found:\n${candidates.map((candidate) => `  ${candidate}`).join("\n")}\nChoose one with --config.`,
  portInvalid: () => "--port must be an integer between 1 and 65535",
  languageInvalid: () => "--language must be ja or en",
  unknownCommand: (command) => `Unknown command: ${command}`,
  initCancelled: () => "Initialization cancelled",
  initUnknownPlugin: (name, available) => `Unknown plugin: ${name} (${available.join(", ")})`,
  initComplete: (target, created, skipped) => `Vellym workspace created: ${target}\nCreated: ${created}, skipped: ${skipped}`,
  initNext: () => "Next commands:",
  initLinks: () => "User guide: https://vellym.tasclub.com/en/\nAI guide: https://vellym.tasclub.com/llms.txt",
  initGuides: () => "How to use the plugins:",
  initAgentGuide: (root) => `Add this line to AGENTS.md:\nRead ${root === "." ? "" : `${root}/`}VELLYM.md before starting work.`,
  initPackageJsonUnreadable: () => "Warning: package.json is not valid JSON. It was left unchanged; fix it by hand.",
  initPlan: (target, create, skip, update) => [
    `Setup plan (nothing written): ${target}`,
    `Create: ${create.length}, skip: ${skip.length}, update: ${update.length}`,
    ...create.map((file) => `create: ${file}`),
    ...skip.map((file) => `skip: ${file}`),
    ...update.map((file) => `update: ${file}`)
  ].join("\n"),
  migrationTargetInvalid: () => "Specify --to v1",
  migrationPlanSummary: (files, diagnostics) =>
    `Migration plan: ${files} file(s), ${diagnostics} diagnostic(s)`,
  migrationSummary: (files) => `Migration complete: ${files} file(s)`
};

const TABLE: Record<CliLanguage, CliMessages> = { ja, en };

export function getMessages(language: CliLanguage): CliMessages {
  return TABLE[language];
}

/** 生の引数から--languageを例外なく読む。フラグが無い／不正なときはundefinedを
 * 返し、呼び出し側がconfigや既定へフォールバックできるようにする。 */
export function cliLanguageFromArgs(args: string[]): CliLanguage | undefined {
  const index = args.indexOf("--language");
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value === "en" || value === "ja" ? value : undefined;
}
