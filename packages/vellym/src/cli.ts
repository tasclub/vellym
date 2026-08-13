import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  loadRepository,
  applyMigration,
  isLoopbackHost,
  pageSummaries,
  planMigration,
  setupManifest,
  startDevServer
} from "@vellym-internal/runtime-node";
import type { Diagnostic } from "@vellym-internal/core";
import { initializeProject } from "./init-command.js";
import { buildStatic } from "./static-builder.js";
import { VELLYM_VERSION } from "./version.js";
import {
  cliLanguageFromArgs,
  getMessages,
  type CliLanguage,
  type CliMessages
} from "./cli-messages.js";

class UsageError extends Error {}

// CLIの言語は--languageを優先し、無ければ読み込んだconfigのui.language、
// それも無ければ日本語とする。`messages`はCLIの表示文言すべてに使う現在の言語表。
let language: CliLanguage = "ja";
let messages: CliMessages = getMessages(language);

function setLanguage(next: CliLanguage): void {
  language = next;
  messages = getMessages(next);
}

function usage(): string {
  return messages.usage();
}

// コマンド別のヘルプ。initは有効なprofile／template IDも併記して、
// --profile／--templateに何を渡せるかCLI単体で分かるようにする。
function commandHelp(command: string): string {
  switch (command) {
    case "init": {
      const manifest = setupManifest();
      const profiles = manifest.profiles
        .map((profile) => `  ${profile.id}（${profile.title}）`)
        .join("\n");
      const templates = manifest.templates
        .map((template) => `  ${template.id}（${template.title}）`)
        .join("\n");
      return messages.initHelp(profiles, templates);
    }
    case "dev":
      return messages.devHelp();
    case "validate":
      return messages.validateHelp();
    case "build":
      return messages.buildHelp();
    case "migrate":
      return messages.migrateHelp();
    default:
      return usage();
  }
}

// 非JSON出力でも各診断のfile・path・code・messageを一覧表示する。
function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((item) => {
      const label = messages.diagnosticLabel(item.severity);
      const location =
        item.path && item.path !== "/" ? `${item.file} ${item.path}` : item.file;
      return `  [${label}] ${location} (${item.code})\n    ${item.message}`;
    })
    .join("\n");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new UsageError(messages.optionNeedsValue(name));
  return value;
}

function resolveConfigPath(args: string[]): string {
  return path.resolve(option(args, "--config") ?? "vellym.config.yaml");
}

function output(
  json: boolean,
  data: unknown,
  diagnostics: unknown[] = [],
  text?: string
): void {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: "1.0", data, diagnostics }, null, 2)}\n`
    );
  } else if (text) {
    process.stdout.write(`${text}\n`);
  }
}

async function validateCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const loaded = await loadConfig(resolveConfigPath(args));
  if (!cliLanguageFromArgs(args)) setLanguage(loaded.config.ui.language);
  const repository = await loadRepository(loaded.contentRoot);
  const summary = messages.validateSummary(
    repository.pages.length,
    repository.diagnostics.length
  );
  const text =
    repository.diagnostics.length > 0
      ? `${summary}\n${formatDiagnostics(repository.diagnostics)}`
      : summary;
  output(json, { pages: pageSummaries(repository) }, repository.diagnostics, text);
  return repository.diagnostics.some((item) => item.severity === "error") ? 1 : 0;
}

async function buildCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const result = await buildStatic(resolveConfigPath(args));
  output(json, result.data, result.diagnostics, result.message);
  return result.exitCode;
}

async function migrateCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const target = option(args, "--to");
  if (target !== "v1") throw new UsageError(messages.migrationTargetInvalid());
  const configPath = resolveConfigPath(args);
  const loaded = await loadConfig(configPath);
  if (!cliLanguageFromArgs(args)) setLanguage(loaded.config.ui.language);
  const plan = await planMigration(configPath);
  if (args.includes("--plan")) {
    output(
      json,
      plan,
      plan.diagnostics,
      messages.migrationPlanSummary(plan.files.length, plan.diagnostics.length)
    );
    return plan.diagnostics.some((item) => item.severity === "error") ? 1 : 0;
  }
  const result = await applyMigration(plan);
  output(json, result, [], messages.migrationSummary(result.migrated));
  return 0;
}

async function devCommand(args: string[]): Promise<void> {
  const host = option(args, "--host") ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") {
    throw new UsageError(messages.hostInvalid());
  }
  const portValue = option(args, "--port") ?? "4173";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(messages.portInvalid());
  }
  const configPath = resolveConfigPath(args);
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const server = await startDevServer({
    configPath,
    uiRoot: path.join(directory, "ui"),
    host,
    port
  });
  if (!isLoopbackHost(host)) {
    process.stderr.write(`${messages.externalBindWarning()}\n`);
  }
  process.stdout.write(`Vellym: ${server.url}\n`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const argLanguage = cliLanguageFromArgs(args);
  if (argLanguage) setLanguage(argLanguage);
  const command = args[0];
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(usage());
    return;
  }
  if (command === "--version") {
    process.stdout.write(`${VELLYM_VERSION}\n`);
    return;
  }
  if (
    ["init", "dev", "validate", "build", "migrate"].includes(command) &&
    args.slice(1).includes("--help")
  ) {
    process.stdout.write(commandHelp(command));
    return;
  }
  if (command === "init") {
    const profileValue = option(args.slice(1), "--profile");
    const languageValue = option(args.slice(1), "--language");
    if (languageValue && languageValue !== "ja" && languageValue !== "en") {
      throw new UsageError(messages.languageInvalid());
    }
    await initializeProject(
      args[1] && !args[1].startsWith("--") ? args[1] : undefined,
      {
        planOnly: args.includes("--plan"),
        json: args.includes("--json"),
        yes: args.includes("--yes"),
        language: languageValue as "ja" | "en" | undefined,
        contentRoot: option(args.slice(1), "--content-root"),
        templateIds: option(args.slice(1), "--template")?.split(","),
        profiles: profileValue
          ? profileValue.split(",") as import("@vellym-internal/runtime-node").SetupProfileId[]
          : undefined
      }
    );
    return;
  }
  if (command === "validate") {
    process.exitCode = await validateCommand(args.slice(1));
    return;
  }
  if (command === "build") {
    process.exitCode = await buildCommand(args.slice(1));
    return;
  }
  if (command === "migrate") {
    process.exitCode = await migrateCommand(args.slice(1));
    return;
  }
  if (command === "dev") {
    await devCommand(args.slice(1));
    return;
  }
  throw new UsageError(`${messages.unknownCommand(command)}\n${usage()}`);
}

main().catch((error) => {
  if (error && typeof error === "object" && "name" in error && error.name === "ExitPromptError") {
    process.stderr.write(`${messages.initCancelled()}\n`);
    process.exitCode = 130;
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
