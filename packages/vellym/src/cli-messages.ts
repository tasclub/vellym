// CLIの表示文言を日本語・英語で切り替えるための軽量なメッセージ表。
// --language／ui.languageに応じて同じフラグで日英どちらの出力も得られる。
// initは候補選択を持たず、規模・開発方式・言語から厳格案を生成する。

export type CliLanguage = "ja" | "en";

export interface CliMessages {
  usage(): string;
  initHelp(): string;
  devHelp(): string;
  validateHelp(): string;
  buildHelp(): string;
  migrateHelp(): string;
  diagnosticLabel(severity: "error" | "warning"): string;
  optionNeedsValue(name: string): string;
  validateSummary(pages: number, diagnostics: number): string;
  hostInvalid(): string;
  externalBindWarning(): string;
  portInvalid(): string;
  languageInvalid(): string;
  unknownCommand(command: string): string;
  initCancelled(): string;
  migrationTargetInvalid(): string;
  migrationPlanSummary(files: number, diagnostics: number): string;
  migrationSummary(files: number): string;
}

const ja: CliMessages = {
  usage: () => `Vellym

Usage:
  vellym init [directory] --size <size> --method <method> --language <ja|en> [--content-root <path>]
  vellym dev [--config <path>] [--host <address>] [--port <number>]
  vellym validate [--config <path>] [--json]
  vellym build [--config <path>] [--json]
  vellym migrate --to v1 [--config <path>] [--plan] [--json]

コマンド別の詳しい説明・例は「vellym <command> --help」で確認できます。
`,
  initHelp: () => `vellym init [directory] [options]

規模と開発方式に対応する厳格案のFolder・Pageを一括生成します。

Options:
  --size <value>        personal | small-team | medium-large
  --method <value>      agile | hybrid | waterfall
  --language <ja|en>    初期生成言語
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

例:
  vellym validate
  vellym validate --json
`,
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
  portInvalid: () => "--portは1から65535の整数で指定してください",
  languageInvalid: () => "--languageはjaまたはenを指定してください",
  unknownCommand: (command) => `不明なコマンドです: ${command}`,
  initCancelled: () => "初期化をキャンセルしました",
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
  vellym validate [--config <path>] [--json]
  vellym build [--config <path>] [--json]
  vellym migrate --to v1 [--config <path>] [--plan] [--json]

Run "vellym <command> --help" for per-command details and examples.
`,
  initHelp: () => `vellym init [directory] [options]

Creates the strict Folder and Page set for the selected size and development method.

Options:
  --size <value>        personal | small-team | medium-large
  --method <value>      agile | hybrid | waterfall
  --language <ja|en>    Language for generated documents
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

Examples:
  vellym validate
  vellym validate --json
`,
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
  portInvalid: () => "--port must be an integer between 1 and 65535",
  languageInvalid: () => "--language must be ja or en",
  unknownCommand: (command) => `Unknown command: ${command}`,
  initCancelled: () => "Initialization cancelled",
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
