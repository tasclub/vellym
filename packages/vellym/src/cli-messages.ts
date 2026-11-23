// CLIの表示文言を日本語・英語で切り替えるための軽量なメッセージ表。
// --language／ui.languageに応じて同じフラグで日英どちらの出力も得られる。
// initは候補選択を持たず、規模・開発方式・言語と--level（既定standard）から生成する。

import { OFFICIAL_PLUGINS } from "./version.js";

export type CliLanguage = "ja" | "en";

const officialPluginList = (): string => Object.keys(OFFICIAL_PLUGINS).join(",");

export interface CliMessages {
  usage(): string;
  initHelp(): string;
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
  portInvalid(): string;
  languageInvalid(): string;
  unknownCommand(command: string): string;
  initCancelled(): string;
  initMissing(missing: string[]): string;
  initUnknownPlugin(name: string, available: readonly string[]): string;
  initConflict(paths: string): string;
  initComplete(target: string, created: number, skipped: number): string;
  initNext(): string;
  initGuides(): string;
  initPackageJsonKept(): string;
  initPackageJsonUnreadable(): string;
  initInstallPlugins(): string;
  initPlan(target: string, create: string[], skip: string[], conflict: string[]): string;
  initForeignContentRoot(contentRoot: string): string;
  initForeignContentRootWarning(contentRoot: string): string;
  migrationTargetInvalid(): string;
  migrationPlanSummary(files: number, diagnostics: number): string;
  migrationSummary(files: number): string;
}

const ja: CliMessages = {
  usage: () => `Vellym

Usage:
  vellym init [directory] --size <size> --method <method> --language <ja|en> [--content-root <path>]
  vellym dev [--config <path>] [--host <address>] [--port <number>]
  vellym validate [--config <path>] [--json] [--strict]
  vellym list --kind <kind> [--where <key>=<value>]... [--json] [--config <path>] [--language ja|en]
  vellym schema --kind <kind> [--config <path>] [--language ja|en]
  vellym schema --list [--config <path>] [--language ja|en]
  vellym build [--config <path>] [--json]
  vellym migrate --to v1 [--config <path>] [--plan] [--json]

コマンド別の詳しい説明・例は「vellym <command> --help」で確認できます。
`,
  initHelp: () => `vellym init [directory] [options]

規模と開発方式に対応するFolder・Pageを、--levelの大きさで一括生成します。

Options:
  --size <value>        personal | small-team | medium-large
  --method <value>      agile | hybrid | waterfall
  --language <ja|en>    初期生成言語
  --plugins <list>      ${officialPluginList()}（任意）
  --level <value>       light | standard | strict（既定: standard。ブラウザの初回設定と同じ）
  --dry-run             作成・skip・競合するファイルを表示し、何も書かない（--jsonでJSON）
  --use-existing-content-root  Vellymの文書ではないファイルがあるcontent rootをそのまま使う
  --content-root <path> project rootからのcontent root相対path（既定: docs）

例:
  vellym init ./my-docs --size small-team --method hybrid --language ja
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
  portInvalid: () => "--portは1から65535の整数で指定してください",
  languageInvalid: () => "--languageはjaまたはenを指定してください",
  unknownCommand: (command) => `不明なコマンドです: ${command}`,
  initCancelled: () => "初期化をキャンセルしました",
  initMissing: (missing) => `必須オプションが不足しています: ${missing.join(", ")}\n指定できる値: --size personal|small-team|medium-large, --method agile|hybrid|waterfall, --language ja|en\n例: vellym init my-project --size small-team --method hybrid --language ja --plugins tickets,kanban`,
  initUnknownPlugin: (name, available) => `不明なプラグイン: ${name} (${available.join(", ")})`,
  initConflict: (paths) => `既存ファイルと競合しています: ${paths}`,
  initComplete: (target, created, skipped) => `初期化しました: ${target}\n作成: ${created}件、skip: ${skipped}件`,
  initNext: () => "次のコマンド:",
  initGuides: () => "プラグインの使い方:",
  initPackageJsonKept: () => "既存のpackage.jsonは変更していません。",
  initPackageJsonUnreadable: () => "注意: package.jsonがJSONとして読めません。変更していないので、手で直してください。",
  initInstallPlugins: () => "vellymとプラグインをプロジェクトに入れるには次を実行します:",
  initPlan: (target, create, skip, conflict) => [
    `初期化の計画（何も書いていません）: ${target}`,
    `作成: ${create.length}件、skip: ${skip.length}件、競合: ${conflict.length}件`,
    ...create.map((file) => `create: ${file}`),
    ...skip.map((file) => `skip: ${file}`),
    ...conflict.map((file) => `conflict: ${file}`),
    ...(conflict.length ? ["競合があるため、実際のinitはここで止まります。"] : [])
  ].join("\n"),
  initForeignContentRoot: (contentRoot) => `${contentRoot}にはVellymの文書ではないファイルがあります。別の場所を--content-rootで指定するか、そのまま使う場合は--use-existing-content-rootを付けてください。`,
  initForeignContentRootWarning: (contentRoot) => `注意: ${contentRoot}にはVellymの文書ではないファイルがあります。実際のinitは、--content-rootで別の場所を指定するか--use-existing-content-rootを付けない限り止まります。`,
  migrationTargetInvalid: () => "--to v1を指定してください",
  migrationPlanSummary: (files, diagnostics) =>
    `migration予定: ${files}ファイル、診断${diagnostics}件`,
  migrationSummary: (files) => `migration完了: ${files}ファイル`
};

const en: CliMessages = {
  usage: () => `Vellym

Usage:
  vellym init [directory] --size <size> --method <method> --language <ja|en> [--content-root <path>]
  vellym dev [--config <path>] [--host <address>] [--port <number>]
  vellym validate [--config <path>] [--json] [--strict]
  vellym list --kind <kind> [--where <key>=<value>]... [--json] [--config <path>] [--language ja|en]
  vellym schema --kind <kind> [--config <path>] [--language ja|en]
  vellym schema --list [--config <path>] [--language ja|en]
  vellym build [--config <path>] [--json]
  vellym migrate --to v1 [--config <path>] [--plan] [--json]

Run "vellym <command> --help" for per-command details and examples.
`,
  initHelp: () => `vellym init [directory] [options]

Creates the Folder and Page set for the selected size and development method, at the --level size.

Options:
  --size <value>        personal | small-team | medium-large
  --method <value>      agile | hybrid | waterfall
  --language <ja|en>    Language for generated documents
  --plugins <list>      ${officialPluginList()} (optional)
  --level <value>       light | standard | strict (default: standard, as in the browser setup)
  --dry-run             List the files to create, skip, or conflict, and write nothing (--json for JSON)
  --use-existing-content-root  Use a content root that holds non-Vellym files as it is
  --content-root <path> Content root relative to the project root (default: docs)

Examples:
  vellym init ./my-docs --size small-team --method hybrid --language en
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
  portInvalid: () => "--port must be an integer between 1 and 65535",
  languageInvalid: () => "--language must be ja or en",
  unknownCommand: (command) => `Unknown command: ${command}`,
  initCancelled: () => "Initialization cancelled",
  initMissing: (missing) => `Missing required options: ${missing.join(", ")}\nAvailable values: --size personal|small-team|medium-large, --method agile|hybrid|waterfall, --language ja|en\nExample: vellym init my-project --size small-team --method hybrid --language en --plugins tickets,kanban`,
  initUnknownPlugin: (name, available) => `Unknown plugin: ${name} (${available.join(", ")})`,
  initConflict: (paths) => `init: already exists (existing_file): ${paths}`,
  initComplete: (target, created, skipped) => `Vellym workspace created: ${target}\nCreated: ${created}, skipped: ${skipped}`,
  initNext: () => "Next commands:",
  initGuides: () => "How to use the plugins:",
  initPackageJsonKept: () => "The existing package.json was left unchanged.",
  initPackageJsonUnreadable: () => "Warning: package.json is not valid JSON. It was left unchanged; fix it by hand.",
  initInstallPlugins: () => "To add vellym and the plugins to the project, run:",
  initPlan: (target, create, skip, conflict) => [
    `Setup plan (nothing written): ${target}`,
    `Create: ${create.length}, skip: ${skip.length}, conflicts: ${conflict.length}`,
    ...create.map((file) => `create: ${file}`),
    ...skip.map((file) => `skip: ${file}`),
    ...conflict.map((file) => `conflict: ${file}`),
    ...(conflict.length ? ["The real init stops here because of the conflicts."] : [])
  ].join("\n"),
  initForeignContentRoot: (contentRoot) => `${contentRoot} holds files that are not Vellym documents. Choose another place with --content-root, or add --use-existing-content-root to use it as it is.`,
  initForeignContentRootWarning: (contentRoot) => `Warning: ${contentRoot} holds files that are not Vellym documents. The real init stops unless you choose another place with --content-root or add --use-existing-content-root.`,
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
