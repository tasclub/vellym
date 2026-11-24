import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  loadConfig,
  diagnoseAssets,
  diagnoseFileLinks,
  loadRepository,
  applyMigration,
  isLoopbackHost,
  loadPlugins,
  pageSummaries,
  pluginKinds,
  planMigration,
  resourceSchema,
  startDevServer
} from "@vellym-internal/runtime-node";
import { API_SCHEMA_VERSION, type Diagnostic } from "@vellym-internal/core";
import { initializeProject } from "./init-command.js";
import { buildStatic } from "./static-builder.js";
import { VELLYM_VERSION } from "./version.js";
import { resolveLocalizedText } from "@vellym/plugin-api";
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

function commandHelp(command: string): string {
  switch (command) {
    case "init": {
      return messages.initHelp();
    }
    case "dev":
      return messages.devHelp();
    case "validate":
      return messages.validateHelp();
    case "list":
      return messages.listHelp();
    case "schema":
      return messages.schemaHelp();
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
      return `  [${label}] ${location} (${item.code})\n    ${resolveLocalizedText(item.message, language)}`;
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
    const localizedDiagnostics = diagnostics.map((diagnostic) => {
      if (!diagnostic || typeof diagnostic !== "object" || !("message" in diagnostic)) {
        return diagnostic;
      }
      const item = diagnostic as { message: import("@vellym/plugin-api").PluginLocalizedText };
      return { ...diagnostic, message: resolveLocalizedText(item.message, language) };
    });
    process.stdout.write(
      `${JSON.stringify({ apiSchemaVersion: API_SCHEMA_VERSION, data, diagnostics: localizedDiagnostics }, null, 2)}\n`
    );
  } else if (text) {
    process.stdout.write(`${text}\n`);
  }
}

async function validateCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  const loaded = await loadConfig(resolveConfigPath(args), cliLanguageFromArgs(args) ?? "ja");
  if (!cliLanguageFromArgs(args)) setLanguage(loaded.config.ui.language);
  // プラグインの失敗は警告。strictでは警告も失敗にする。
  const plugins = await loadPlugins({
    configDir: path.dirname(loaded.configPath),
    packageNames: loaded.config.plugins,
    hostVersion: VELLYM_VERSION
  });
  const repository = await loadRepository(loaded.contentRoot, undefined, pluginKinds(plugins));
  const diagnostics = [...repository.diagnostics, ...plugins.diagnostics, ...await diagnoseAssets(loaded, repository), ...await diagnoseFileLinks(loaded, repository)];
  const summary = messages.validateSummary(repository.pages.length, diagnostics.length);
  const text =
    diagnostics.length > 0
      ? `${summary}\n${formatDiagnostics(diagnostics)}`
      : summary;
  output(json, { pages: pageSummaries(repository) }, diagnostics, text);
  return diagnostics.some((item) => item.severity === "error" || (strict && item.severity === "warning")) ? 1 : 0;
}

async function listCommand(args: string[]): Promise<number> {
  const kind = option(args, "--kind");
  if (!kind) throw new UsageError(messages.listKindRequired());
  const filters: Array<[string, string]> = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--where") continue;
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new UsageError(messages.optionNeedsValue("--where"));
    const equals = value.indexOf("=");
    if (equals < 0) throw new UsageError(messages.listWhereInvalid());
    filters.push([value.slice(0, equals), value.slice(equals + 1)]);
  }
  const languageValue = option(args, "--language");
  if (languageValue && languageValue !== "ja" && languageValue !== "en") throw new UsageError(messages.languageInvalid());
  const loaded = await loadConfig(resolveConfigPath(args), cliLanguageFromArgs(args) ?? "ja");
  if (!cliLanguageFromArgs(args)) setLanguage(loaded.config.ui.language);
  const plugins = await loadPlugins({ configDir: path.dirname(loaded.configPath), packageNames: loaded.config.plugins, hostVersion: VELLYM_VERSION });
  const kinds = pluginKinds(plugins);
  const available = ["Page", ...[...kinds.knownKinds].filter((item) => item !== "Page").sort()];
  if (!available.includes(kind)) throw new UsageError(messages.listKindInvalid(kind, available));
  const repository = await loadRepository(loaded.contentRoot, undefined, kinds);
  const rows = repository.pages.filter((entry) => entry.kind === kind).map((entry) => ({
    name: entry.name, title: entry.title, relativePath: entry.relativePath, values: entry.indexRow ?? {}
  })).filter((row) => filters.every(([key, value]) => {
    const actual = row.values[key];
    return Array.isArray(actual) ? actual.includes(value) : actual === value;
  })).sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
  const text = [...rows.map((row) => `${row.relativePath}\t${row.title}${row.values.status !== undefined ? `\t${row.values.status}` : ""}`), messages.listSummary(rows.length)].join("\n");
  output(args.includes("--json"), { kind, rows }, [...repository.diagnostics, ...plugins.diagnostics], text);
  return 0;
}

const CORE_SCHEMA_KINDS = [
  ["Page", "page.schema.json"],
  ["Folder", "folder.schema.json"],
  ["PageTranslation", "page-translation.schema.json"],
  ["FolderTranslation", "folder-translation.schema.json"]
] as const;

const CORE_SCHEMA_VERSION = "v1";

function readBundledSchema(fileName: string): Record<string, unknown> {
  const schemaDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "schemas");
  return JSON.parse(readFileSync(path.join(schemaDirectory, fileName), "utf8")) as Record<string, unknown>;
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coreSchemaForKind(kind: string): Record<string, unknown> | undefined {
  const entry = CORE_SCHEMA_KINDS.find(([name]) => name === kind);
  if (!entry) return undefined;
  const [_, fileName] = entry;
  const schema = readBundledSchema(fileName);
  if (kind === "Page" || kind === "Folder") {
    const properties = isSchemaObject(schema.properties) ? schema.properties : {};
    const specSchema = isSchemaObject(properties.spec) ? properties.spec : {};
    return resourceSchema({
      pageSchema: schema,
      kind,
      specSchema,
      version: CORE_SCHEMA_VERSION
    });
  }
  // Translation schemas describe the translation mapping stored inside a resource.
  // They have no apiVersion/kind/spec envelope, but use the same versioned public ID.
  return {
    ...schema,
    $id: `https://vellym.tasclub.com/schemas/${CORE_SCHEMA_VERSION}/${fileName}`
  };
}

async function schemaCommand(args: string[]): Promise<number> {
  const list = args.includes("--list");
  const kind = option(args, "--kind");
  const configPath = option(args, "--config");
  const languageValue = option(args, "--language");
  if (languageValue && languageValue !== "ja" && languageValue !== "en") {
    throw new UsageError(messages.languageInvalid());
  }
  if (list && kind) throw new UsageError(messages.schemaModeInvalid());
  if (!list && !kind) throw new UsageError(messages.schemaKindRequired());

  const loaded = configPath
    ? await loadConfig(path.resolve(configPath), cliLanguageFromArgs(args) ?? "ja")
    : undefined;
  if (loaded && !cliLanguageFromArgs(args)) setLanguage(loaded.config.ui.language);
  const plugins = loaded
    ? await loadPlugins({
        configDir: path.dirname(loaded.configPath),
        packageNames: loaded.config.plugins,
        hostVersion: VELLYM_VERSION
      })
    : undefined;
  const kinds = plugins ? pluginKinds(plugins) : undefined;
  const pluginDiagnostics = plugins?.diagnostics ?? [];
  const unresolvedPluginDiagnostics = pluginDiagnostics.filter(
    (diagnostic) => diagnostic.code === "PLUGIN_RESOLVE_FAILED"
  );
  let unresolvedPluginPackages: string[] = [];
  if (loaded && unresolvedPluginDiagnostics.length > 0) {
    const configuredPlugins = loaded.config.plugins;
    const failedIndexes = unresolvedPluginDiagnostics.map((diagnostic) => {
      const match = diagnostic.path?.match(/^\/plugins\/(\d+)$/);
      return match ? Number(match[1]) : undefined;
    });
    const canMapFailedPackages = failedIndexes.every(
      (index) =>
        index !== undefined &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < configuredPlugins.length &&
        typeof configuredPlugins[index] === "string"
    );
    unresolvedPluginPackages = [
      ...new Set(
        canMapFailedPackages
          ? failedIndexes.map((index) => configuredPlugins[index!]!)
          : configuredPlugins
      )
    ];
  }
  if (pluginDiagnostics.length > 0) {
    process.stderr.write(`${formatDiagnostics(pluginDiagnostics)}\n`);
  }
  const available = [
    ...CORE_SCHEMA_KINDS.map(([name]) => name),
    ...[...(kinds?.knownKinds ?? [])]
      .filter((name) => !CORE_SCHEMA_KINDS.some(([coreName]) => coreName === name))
      .sort()
  ];

  if (list) {
    if (unresolvedPluginDiagnostics.length > 0) {
      process.stderr.write(`${messages.schemaPluginsMissing()}\n`);
    }
    process.stdout.write(`${available.join("\n")}\n`);
    return 0;
  }

  if (!available.includes(kind!)) {
    if (unresolvedPluginDiagnostics.length > 0) {
      process.stderr.write(
        `${messages.schemaKindUnresolved(kind!, unresolvedPluginPackages)}\n`
      );
      process.stderr.write(`${messages.schemaPluginsMissing()}\n`);
    } else {
      process.stderr.write(`${messages.schemaKindInvalid(kind!, available)}\n`);
    }
    return 1;
  }

  if (unresolvedPluginDiagnostics.length > 0) {
    process.stderr.write(`${messages.schemaPluginsMissing()}\n`);
  }
  const schema = coreSchemaForKind(kind!) ?? resourceSchema({
    pageSchema: readBundledSchema("page.schema.json"),
    kind: kind!,
    specSchema: (kinds?.kindSchemas.get(kind!) ?? {}) as Record<string, unknown>,
    version: CORE_SCHEMA_VERSION
  });
  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
  return 0;
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
  // 読み込めなかったプラグインを起動時に示す。serverの起動は妨げない。
  let configProblem: "missing" | "unreadable" | undefined;
  try {
    const loaded = await loadConfig(configPath);
    const plugins = await loadPlugins({
      configDir: path.dirname(loaded.configPath),
      packageNames: loaded.config.plugins,
      hostVersion: VELLYM_VERSION
    });
    if (plugins.diagnostics.length) {
      process.stderr.write(`${formatDiagnostics(plugins.diagnostics)}\n`);
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    configProblem = code === "CONFIG_NOT_FOUND" || code === "ENOENT" ? "missing" : "unreadable";
  }
  const server = await startDevServer({
    configPath,
    uiRoot: path.join(directory, "ui"),
    host,
    port,
    hostVersion: VELLYM_VERSION
  });
  if (configProblem) {
    process.stderr.write(`${configProblem === "missing" ? messages.configMissing(server.url) : messages.configUnreadable(server.url)}\n`);
  }
  if (!isLoopbackHost(host)) {
    process.stderr.write(`${messages.externalBindWarning()}\n`);
  }
  process.stdout.write(`Vellym: ${server.url}\n`);
  let closing = false;
  // Stopping `dev` (Ctrl+C, or SIGTERM from a test or process manager) must end the process.
  // Closing waits for the file watcher and open connections, which can stall, so it is bounded.
  const close = async () => {
    if (closing) return;
    closing = true;
    setTimeout(() => process.exit(0), 3000).unref();
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
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
    ["init", "dev", "validate", "list", "schema", "build", "migrate"].includes(command) &&
    args.slice(1).includes("--help")
  ) {
    process.stdout.write(commandHelp(command));
    return;
  }
  if (command === "init") {
    const initArgs = args.slice(1);
    const allowed = new Set(["--size", "--method", "--language", "--content-root", "--plugins", "--level", "--dry-run", "--use-existing-content-root", "--json"]);
    const unsupported = initArgs.find(
      (item) => item.startsWith("--") && !allowed.has(item)
    );
    if (unsupported) {
      throw new UsageError(language === "en" ? `Unsupported init option: ${unsupported}` : `initでは${unsupported}を使用できません`);
    }
    const languageValue = option(initArgs, "--language");
    if (languageValue && languageValue !== "ja" && languageValue !== "en") {
      throw new UsageError(messages.languageInvalid());
    }
    const sizeValue = option(initArgs, "--size");
    if (sizeValue && !["personal", "small-team", "medium-large"].includes(sizeValue)) {
      throw new UsageError(language === "en" ? "--size must be personal, small-team, or medium-large" : "--sizeはpersonal、small-team、medium-largeから指定してください");
    }
    const methodValue = option(initArgs, "--method");
    if (methodValue && !["agile", "hybrid", "waterfall"].includes(methodValue)) {
      throw new UsageError(language === "en" ? "--method must be agile, hybrid, or waterfall" : "--methodはagile、hybrid、waterfallから指定してください");
    }
    const levelValue = option(initArgs, "--level");
    if (levelValue && !["light", "standard", "strict"].includes(levelValue)) {
      throw new UsageError(language === "en" ? "--level must be light, standard, or strict" : "--levelはlight、standard、strictから指定してください");
    }
    await initializeProject(
      args[1] && !args[1].startsWith("--") ? args[1] : undefined,
      {
        size: sizeValue as import("@vellym-internal/runtime-node").ProjectSize | undefined,
        method: methodValue as import("@vellym-internal/runtime-node").DevelopmentMethod | undefined,
        language: languageValue as "ja" | "en" | undefined,
        contentRoot: option(initArgs, "--content-root"),
        plugins: option(initArgs, "--plugins"),
        level: levelValue as import("@vellym-internal/runtime-node").DocumentationLevel | undefined,
        dryRun: initArgs.includes("--dry-run"),
        useExistingContentRoot: initArgs.includes("--use-existing-content-root"),
        json: initArgs.includes("--json")
      }
    );
    return;
  }
  if (command === "validate") {
    process.exitCode = await validateCommand(args.slice(1));
    return;
  }
  if (command === "list") {
    process.exitCode = await listCommand(args.slice(1));
    return;
  }
  if (command === "schema") {
    process.exitCode = await schemaCommand(args.slice(1));
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
