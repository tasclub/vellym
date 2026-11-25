import path from "node:path";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { OFFICIAL_PLUGINS, VELLYM_VERSION } from "./version.js";
import { getMessages, type CliLanguage } from "./cli-messages.js";
import { applyInit, planInit, type InitRequest } from "@vellym-internal/runtime-node";
import { loadCatalog } from "../../runtime-node/src/catalog/load.js";

export interface InitializeOptions {
  root?: InitRequest["root"];
  structure?: InitRequest["structure"];
  numbered?: boolean;
  withGuideFolders?: boolean;
  language?: CliLanguage;
  plugins?: string;
  dryRun?: boolean;
  json?: boolean;
}

export function initEnvironmentLanguage(): CliLanguage {
  const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
  return /^ja(?:[_\-.@]|$)/i.test(locale) ? "ja" : "en";
}

export async function initializeProject(targetArgument?: string, options: InitializeOptions = {}): Promise<void> {
  const language = options.language ?? initEnvironmentLanguage();
  const messages = getMessages(language);
  const names = options.plugins === undefined ? [] : [...new Set(options.plugins.split(",").map(name => name.trim()))];
  for (const name of names) {
    if (!Object.hasOwn(OFFICIAL_PLUGINS, name)) throw new Error(messages.initUnknownPlugin(name, Object.keys(OFFICIAL_PLUGINS)));
  }
  const structure = options.structure ?? "by-type";
  const request: InitRequest = {
    root: options.root ?? "docs",
    structure,
    numbered: options.numbered ?? loadCatalog().structures.find(item => item.id === structure)!.numberedByDefault,
    supplementGuide: options.withGuideFolders ?? false,
    language,
    plugins: names.map(id => ({ id, name: OFFICIAL_PLUGINS[id]!.name, version: OFFICIAL_PLUGINS[id]!.version })),
    hostVersion: VELLYM_VERSION
  };
  const target = path.resolve(targetArgument ?? ".");
  // The shared planner requires an existing root. For a new dry-run target use
  // an isolated empty scratch project, never creating anything in the target.
  let scratch: string | undefined;
  let planningRoot = target;
  try {
    await realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (options.dryRun) {
      scratch = await mkdtemp(path.join(tmpdir(), "vellym-init-plan-"));
      planningRoot = path.join(scratch, path.basename(target));
      await mkdir(planningRoot);
    } else await mkdir(target, { recursive: true });
  }
  const plan = await (async () => {
    try { return await planInit(planningRoot, request); }
    finally { if (scratch) await rm(scratch, { recursive: true }); }
  })();
  const paths = (status: "create" | "skip" | "update") => plan.files.filter(file => file.status === status).map(file => file.relativePath);
  if (!options.dryRun) await applyInit(plan);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ...plan, projectRoot: target,
      // A scratch preview is not an apply token for a real project.
      planHash: scratch ? undefined : plan.planHash,
      create: paths("create"), skip: paths("skip"), update: paths("update")
    }, null, 2)}\n`);
    return;
  }
  if (options.dryRun) {
    process.stdout.write(`${messages.initPlan(target, paths("create"), paths("skip"), paths("update"))}\n`);
    return;
  }
  const managementRoot = request.root === "." ? target : path.join(target, request.root);
  process.stdout.write(`${messages.initComplete(managementRoot, paths("create").length, paths("skip").length)}\n`);
  for (const file of paths("skip")) process.stdout.write(`skip: ${file}\n`);
  if (plan.files.some(file => file.reason === "unreadable-json")) process.stderr.write(`${messages.initPackageJsonUnreadable()}\n`);
  process.stdout.write(`${messages.initNext()}\n  cd '${target.replaceAll("'", "'\\''")}'\n  npm install\n  npx vellym dev\n`);
  process.stdout.write(`${messages.initLinks()}\n`);
  const guides = [...new Set(names.flatMap(name => {
    const url = OFFICIAL_PLUGINS[name]!.guideUrl;
    const chosen = url?.[language] ?? url?.en ?? url?.ja;
    return chosen ? [chosen] : [];
  }))];
  if (guides.length) process.stdout.write(`${messages.initGuides()}\n${guides.map(url => `  ${url}`).join("\n")}\n`);
  process.stdout.write(`${messages.initAgentGuide(request.root)}\n`);
}
