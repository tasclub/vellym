import path from "node:path";
import { OFFICIAL_PLUGINS, VELLYM_VERSION } from "./version.js";
import { getMessages } from "./cli-messages.js";
import {
  applyProjectSetup,
  inspectContentRoot,
  planProjectSetup,
  type DevelopmentMethod,
  type DocumentationLevel,
  type ProjectSize,
  type SetupLanguage
} from "@vellym-internal/runtime-node";

export interface InitializeOptions {
  size?: ProjectSize;
  method?: DevelopmentMethod;
  contentRoot?: string;
  language?: SetupLanguage;
  plugins?: string;
  /** Size of the generated set; the browser setup uses the same three. Default standard. */
  level?: DocumentationLevel;
  /** Print the plan and write nothing. */
  dryRun?: boolean;
  /** Write into a content root that already holds non-Vellym files. */
  useExistingContentRoot?: boolean;
  json?: boolean;
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
    level: options.level ?? "standard",
    contentRoot: options.contentRoot ?? "docs",
    pluginPackages,
    hostVersion: VELLYM_VERSION,
    language: options.language!
  };
  const contentRootState = await inspectContentRoot(target, baseOptions.contentRoot);
  const foreign = contentRootState === "foreign" && !options.useExistingContentRoot;
  if (foreign && !options.dryRun) throw new Error(messages.initForeignContentRoot(baseOptions.contentRoot));
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
  const created = plan.files.filter((file) => file.status === "create");
  const skipped = plan.files.filter((file) => file.status === "skip");
  if (options.dryRun) {
    const paths = (files: typeof plan.files) => files.map((file) => file.relativePath);
    const warnings = foreign ? [messages.initForeignContentRootWarning(baseOptions.contentRoot)] : [];
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ target, level: baseOptions.level, create: paths(created), skip: paths(skipped), conflict: paths(conflicts), warnings }, null, 2)}\n`);
    } else {
      process.stdout.write(`${messages.initPlan(target, paths(created), paths(skipped), paths(conflicts))}\n`);
      for (const warning of warnings) process.stdout.write(`${warning}\n`);
    }
    return;
  }
  if (conflicts.length) throw new Error(messages.initConflict(conflicts.map((file) => file.relativePath).join(", ")));
  await applyProjectSetup(plan);
  const keptPackage = plan.files.find((file) => file.kind === "package-json" && file.status === "skip");
  if (keptPackage?.note === "unreadable-json") process.stderr.write(`${messages.initPackageJsonUnreadable()}\n`);
  process.stdout.write(`${messages.initComplete(target, created.length, skipped.length)}\n`);
  for (const file of skipped) process.stdout.write(`skip: ${file.relativePath}\n`);
  if (keptPackage) process.stdout.write(`${messages.initPackageJsonKept()}\n`);
  // Existing package.json files stay untouched; print the exact commands needed
  // to install this Vellym version and any selected plugins.
  if (keptPackage) {
    const commands = [
      `npm install -D vellym@${VELLYM_VERSION}`,
      ...(pluginPackages.length
        ? [`npm install ${pluginPackages.map((item) => `${item.name}@${item.version}`).join(" ")}`]
        : [])
    ];
    process.stdout.write(`${messages.initInstallPlugins()}\n${commands.map((command) => `  ${command}`).join("\n")}\n`);
  }
  process.stdout.write(`${messages.initNext()}\n${keptPackage ? "" : "  npm install\n"}  npx vellym dev\n`);
  process.stdout.write(`${messages.initLinks()}\n`);
  // Each selected plugin names its own guide (package.json vellym.guideUrl); the host knows no plugin.
  const guides = [...new Set(names.flatMap((name) => {
    const url = OFFICIAL_PLUGINS[name]!.guideUrl;
    const chosen = url?.[options.language!] ?? url?.en ?? url?.ja;
    return chosen ? [chosen] : [];
  }))];
  if (guides.length) process.stdout.write(`${messages.initGuides()}\n${guides.map((url) => `  ${url}`).join("\n")}\n`);
}
