import path from "node:path";
import { OFFICIAL_PLUGINS } from "./version.js";
import { getMessages } from "./cli-messages.js";
import {
  applyProjectSetup,
  planProjectSetup,
  type DevelopmentMethod,
  type ProjectSize,
  type SetupLanguage
} from "@vellym-internal/runtime-node";

export interface InitializeOptions {
  size?: ProjectSize;
  method?: DevelopmentMethod;
  contentRoot?: string;
  language?: SetupLanguage;
  plugins?: string;
}

export async function initializeProject(
  targetArgument?: string,
  options: InitializeOptions = {}
): Promise<void> {
  const missing: string[] = [];
  if (!options.size) missing.push("--size");
  if (!options.method) missing.push("--method");
  if (!options.language) missing.push("--language");
  if (missing.length) {
    const detail = (lang: SetupLanguage) => getMessages(lang).initMissing(missing);
    throw new Error(options.language ? detail(options.language) : `${detail("ja")}\n\n${detail("en")}`);
  }
  const messages = getMessages(options.language!);
  const names = options.plugins === undefined ? [] : [...new Set(options.plugins.split(",").map((name) => name.trim()))];
  for (const name of names) {
    if (!Object.hasOwn(OFFICIAL_PLUGINS, name)) throw new Error(messages.initUnknownPlugin(name, Object.keys(OFFICIAL_PLUGINS)));
  }
  const pluginPackages = names.map((name) => ({ name: OFFICIAL_PLUGINS[name]!.name, version: OFFICIAL_PLUGINS[name]!.version }));

  const target = path.resolve(targetArgument ?? ".");
  const baseOptions = {
    mode: "recommended" as const,
    size: options.size!,
    method: options.method!,
    level: "strict" as const,
    contentRoot: options.contentRoot ?? "docs",
    pluginPackages,
    language: options.language!
  };
  let plan = await planProjectSetup(target, baseOptions);

  // CLIは対話的な競合解決を行わない。Page候補のpath競合だけをskipし、
  // config/root metadata等の競合は安全のためapply前にエラーとして残す。
  const resolutions = Object.fromEntries(
    plan.files
      .filter((file) => file.templateId && file.status === "conflict")
      .map((file) => [file.templateId!, "skip" as const])
  );
  if (Object.keys(resolutions).length) {
    plan = await planProjectSetup(target, {
      ...baseOptions,
      conflictResolutions: resolutions
    });
  }

  const conflicts = plan.files.filter((file) => file.status === "conflict");
  if (conflicts.length) throw new Error(messages.initConflict(conflicts.map((file) => file.relativePath).join(", ")));
  await applyProjectSetup(plan);
  const created = plan.files.filter((file) => file.status === "create");
  const skipped = plan.files.filter((file) => file.status === "skip");
  process.stdout.write(`${messages.initComplete(target, created.length, skipped.length)}\n`);
  for (const file of skipped) process.stdout.write(`skip: ${file.relativePath}\n`);
  process.stdout.write(`${messages.initNext()}\n${pluginPackages.length ? "  npm install\n" : ""}  npx vellym dev\n`);
}
