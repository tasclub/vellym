import path from "node:path";
import { readFile } from "node:fs/promises";
import { API_SCHEMA_VERSION } from "@vellym-internal/core";
import { appendGuideSection, applyAdd, loadConfig, loadPlugins, planAdd, pluginResourceTemplates, pluginGuideSections, RuntimeError } from "@vellym-internal/runtime-node";
import { loadCatalog } from "../../runtime-node/src/catalog/load.js";
import { VELLYM_VERSION } from "./version.js";

export class AddUsageError extends Error {}

export async function addCommand(args: string[], configPath: string): Promise<number> {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--folder", "--name", "--config", "--language"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--") || values.has(arg)) throw new AddUsageError(`${arg}: value required`);
      values.set(arg, value);
    } else if (["--list", "--guide", "--no-guide", "--dry-run", "--json"].includes(arg)) {
      if (flags.has(arg)) throw new AddUsageError(`Duplicate option: ${arg}`);
      flags.add(arg);
    } else if (arg.startsWith("--")) throw new AddUsageError(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (flags.has("--guide") && flags.has("--no-guide")) throw new AddUsageError("--guide and --no-guide are mutually exclusive");
  const lang = values.get("--language");
  if (lang && lang !== "ja" && lang !== "en") throw new AddUsageError("--language: ja|en");
  const loaded = await loadConfig(configPath, lang ?? "ja");
  const language: "ja" | "en" = lang === "ja" || lang === "en" ? lang : loaded.config.ui.language;
  const plugins = await loadPlugins({ configDir: path.dirname(loaded.configPath), packageNames: loaded.config.plugins, hostVersion: VELLYM_VERSION });
  const resources = pluginResourceTemplates(plugins.plugins);
  const catalog = loadCatalog(resources);
  const json = flags.has("--json");
  const output = (data: unknown, text: string) => process.stdout.write(json
    ? `${JSON.stringify({ apiSchemaVersion: API_SCHEMA_VERSION, data, diagnostics: plugins.diagnostics }, null, 2)}\n`
    : `${text}\n`);
  if (positional[0] === "guide") {
    if (positional.length !== 1 || values.has("--folder") || values.has("--name") || values.has("--language") || flags.has("--guide") || flags.has("--no-guide") || flags.has("--list")) throw new AddUsageError("add guide [--config <path>] [--dry-run] [--json]");
    const guidePath = path.join(path.dirname(loaded.configPath), "VELLYM.md");
    const source = await readFile(guidePath, "utf8");
    const sections = pluginGuideSections(plugins.plugins, language);
    const existing = sections.filter(section => source.includes(`<!-- vellym:guide:${section.id} -->`));
    const added = sections.filter(section => !existing.includes(section));
    const missing = loaded.config.plugins.filter(name => !plugins.plugins.some(plugin => plugin.packageName === name));
    if (!flags.has("--dry-run")) for (const section of added) await appendGuideSection(guidePath, section);
    output({ added: added.map(s => s.id), existing: existing.map(s => s.id), missing, dryRun: flags.has("--dry-run") }, `added: ${added.map(s => s.id).join(", ")}\nexisting: ${existing.map(s => s.id).join(", ")}\nmissing: ${missing.join(", ")}`);
    return 0;
  }
  if (flags.has("--list")) {
    if (positional.length > 1 || (positional[0] && !["template", "set"].includes(positional[0])) || values.has("--folder") || values.has("--name") || flags.has("--guide") || flags.has("--no-guide") || flags.has("--dry-run")) throw new AddUsageError("add --list [template|set]");
    const entries = [
      ...(positional[0] === "set" ? [] : [...catalog.templates, ...catalog.resources].map(item => ({ kind: "template", id: item.id, description: item.description[language] }))),
      ...(positional[0] === "template" ? [] : catalog.sets.map(item => ({ kind: "set", id: item.id, description: item.description[language] })))
    ];
    output(entries, entries.map(item => `${item.kind}\t${item.id}\t${item.description}`).join("\n"));
    return 0;
  }
  if (positional.length !== 2 || !["template", "set"].includes(positional[0]!)) throw new AddUsageError("add template|set <id>");
  const [kind, id] = positional as ["template" | "set", string];
  const resource = kind === "template" && id.includes(":");
  let plan;
  try {
    plan = await planAdd(loaded, { kind: resource ? "resource" : kind, id, folder: values.get("--folder"), name: values.get("--name"), language, guide: flags.has("--guide") }, { resources });
  } catch (error) {
    if (error instanceof RuntimeError && error.code === "ADD_REQUEST") throw new AddUsageError(error.message);
    throw error;
  }
  const text = plan.files.map(file => `${file.status}: ${file.relativePath}${file.name ? ` (${file.name})` : ""}${file.reason ? ` - ${file.reason.message[language]}` : ""}`).join("\n");
  output({ plan, dryRun: flags.has("--dry-run") }, text);
  if (!flags.has("--dry-run")) {
    await applyAdd(loaded, plan, { resources });
    if (flags.has("--guide")) {
      const definition = kind === "set" ? catalog.sets.find(item => item.id === id) : [...catalog.templates, ...catalog.resources].find(item => item.id === id);
      if (definition) {
        const body = "guideText" in definition && definition.guideText ? definition.guideText[language] : definition.description[language];
        await appendGuideSection(path.join(path.dirname(loaded.configPath), "VELLYM.md"), { id: `add-${kind}-${id}`, title: definition.title[language], body });
      }
    }
  }
  return 0;
}
