import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { STABLE_API_VERSION } from "@vellym-internal/core";
import { loadCatalog } from "./catalog/load.js";
import type { FolderDef, ResourceTemplateDef, Role } from "./catalog/types.js";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";
import type { LoadedConfig } from "./types.js";
import { applyFileTransaction } from "./file-transaction.js";

export interface AddRequest {
  kind: "template" | "resource" | "set";
  id: string;
  folder?: string;
  name?: string;
  language: "ja" | "en";
  guide?: boolean;
}

export interface AddPlanFile {
  /** Relative to contentRoot, not the project root. */
  relativePath: string;
  status: "create" | "skip" | "rename";
  kind: string;
  reason?: { code: "EXISTS" | "PLUGIN_NOT_ENABLED"; message: { ja: string; en: string } };
  title: string;
  name?: string;
  /** Complete source, included in the plan hash. */
  source: string;
}

export interface AddPlan {
  request: AddRequest;
  files: AddPlanFile[];
  guide?: { append: boolean };
  /** Stable random identities let apply rebuild exactly the previewed plan. */
  identities: string[];
  planHash: string;
}

export interface AddOptions {
  resources?: ResourceTemplateDef[];
}

function invalid(message: string): never {
  throw new RuntimeError(message, 400, "ADD_REQUEST");
}

function safeFolder(value: string): string {
  if (value === "") return "";
  if (path.isAbsolute(value) || /[\\\0]/.test(value) ||
      value.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
    invalid("作成先は文書の置き場所内の相対フォルダで指定してください");
  }
  return value.normalize("NFC");
}

/** Same normalization as ticket-engine's slugOf. */
function slugOf(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/**
 * The file or folder name made from a name the user typed (FR-08).
 *
 * Names that are ASCII after NFKC keep the slug they always had. Names with other characters
 * (Japanese) keep the characters: only what a path cannot hold becomes "-".
 * This is the visible file name, not `metadata.name`. Returns "" when nothing
 * is left; the caller then uses the template's own name.
 */
function fileNameOf(value: string): string {
  // Full-width Latin ("Ｆｉｘ") folds to ASCII and keeps its old slug too.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(value.normalize("NFKC"))) return slugOf(value);
  // eslint-disable-next-line no-control-regex
  const name = value.normalize("NFC").replace(/[/\\:*?"<>|\p{Cc}\s]/gu, "-")
    .replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return Array.from(name).slice(0, 60).join("").replace(/[-.]+$/g, "");
}

function identity(kind: string): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  let value = (BigInt(Date.now()) << 80n) | BigInt(`0x${randomBytes(10).toString("hex")}`);
  let result = "";
  for (let i = 0; i < 26; i++) {
    result = alphabet[Number(value & 31n)]! + result;
    value >>= 5n;
  }
  return `${kind}-${result}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function info(target: string) {
  try { return await lstat(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Check existing ancestors even during preview. Never follow an escaping symlink. */
async function boundary(root: string, relative: string): Promise<void> {
  let current = root;
  for (const part of relative.split("/").filter(Boolean)) {
    current = path.join(current, part);
    if (!(await info(current))) return;
    const resolved = await realpath(current);
    if (resolved !== root && !isInside(root, resolved)) {
      throw new RuntimeError("contentRoot外への作成は許可されていません", 422, "PATH_BOUNDARY");
    }
  }
}

async function buildPlan(config: LoadedConfig, input: AddRequest, options: AddOptions, seeds?: string[]): Promise<AddPlan> {
  if (!input || !["template", "resource", "set"].includes(input.kind) ||
      !["ja", "en"].includes(input.language) || typeof input.id !== "string" ||
      (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || /[\0\r\n]/.test(input.name))) ||
      (input.folder !== undefined && typeof input.folder !== "string") ||
      (input.guide !== undefined && typeof input.guide !== "boolean")) invalid("追加の指定が不正です");
  const request = { ...input };
  if (request.folder !== undefined) request.folder = safeFolder(request.folder);
  if (request.name !== undefined) request.name = request.name.trim();
  const language = request.language;
  const root = await realpath(config.contentRoot);
  const configSource = await readFile(config.configPath, "utf8");
  // setup is read from the configuration source so older core config types need
  // not know the new optional hint; no configuration file is rewritten here.
  const setup = parse(configSource)?.setup as { structure?: string; numbered?: boolean; folderNames?: Record<string, string> } | undefined;
  const catalog = loadCatalog(options.resources);
  const usedResources: ResourceTemplateDef[] = [];
  const structure = catalog.structures.find(item => item.id === (setup?.structure ?? "by-type"));
  if (!structure || structure.supplement) invalid("不明な構成の型です");
  const folders = new Map<string, string>();
  const visit = (items: FolderDef[], parent = "") => {
    items.forEach((folder, index) => {
      const numbered = setup?.numbered ?? structure.numberedByDefault;
      const label = setup?.folderNames?.[folder.id] ??
        `${numbered ? `${String(index).padStart(2, "0")}_` : ""}${folder.name[language]}`;
      const destination = safeFolder(path.posix.join(parent, label));
      folders.set(folder.id, destination);
      visit(folder.children ?? [], destination);
    });
  };
  visit(structure.folders);
  const destination = (role: Role): string => {
    if (request.folder !== undefined) return request.folder;
    const target = structure.roleMap[role];
    const folderId = typeof target === "string" ? target : target.folderId;
    const base = folders.get(folderId)!;
    if (typeof target !== "string" && target.feature) {
      if (!request.name) invalid("機能別の文書には名前か作成先が必要です");
      return path.posix.join(base, fileNameOf(request.name) || "feature");
    }
    return base;
  };

  const files: AddPlanFile[] = [];
  const identities: string[] = [];
  const names = new Set<string>();
  const state: Record<string, string> = {};
  // Name collisions include plugin resources, not just built-in Pages.
  const scan = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || ["node_modules", "dist"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (absolute === config.outputDir || absolute === config.assetsRoot) continue;
      if (entry.isDirectory()) await scan(absolute);
      else if (/\.ya?ml$/i.test(entry.name)) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        await boundary(root, relative);
        if (!(await stat(absolute)).isFile()) continue;
        const source = await readFile(absolute, "utf8");
        state[relative] = hash(source);
        try {
          const name = parse(source)?.metadata?.name;
          if (typeof name === "string") names.add(name);
        } catch { /* Unrelated malformed YAML is still covered by the hash. */ }
      }
    }
  };
  await scan(root);
  const observe = async (relative: string): Promise<boolean> => {
    await boundary(root, relative);
    const target = path.join(root, relative);
    const existing = await info(target);
    const resolved = existing?.isSymbolicLink() ? `:${await realpath(target)}` : "";
    state[`path:${relative}`] = !existing ? "missing" : (await stat(target)).isDirectory() ? `directory${resolved}` :
      `file${resolved}:${hash(await readFile(target, "utf8"))}`;
    return Boolean(existing);
  };
  const ensureFolders = async (directory: string): Promise<void> => {
    let current = "";
    for (const part of directory.split("/").filter(Boolean)) {
      current = path.posix.join(current, part);
      const exists = await observe(current);
      if (exists && !(await stat(path.join(root, current))).isDirectory()) {
        invalid(`作成先がフォルダではありません: ${current}`);
      }
      const relativePath = path.posix.join(current, "_index.yaml");
      if (!exists && !files.some(file => file.relativePath === relativePath)) {
        files.push({
          relativePath, kind: "Folder", status: "create", title: part,
          source: stringify({ apiVersion: STABLE_API_VERSION, kind: "Folder", metadata: { title: part }, spec: { locale: language, order: [] } })
        });
      }
    }
  };
  const add = async (kind: "template" | "resource", id: string, directory?: string, customName?: string) => {
    const template = kind === "template" ? catalog.templates.find(item => item.id === id) : undefined;
    const resource = kind === "resource" ? catalog.resources.find(item => item.id === id) : undefined;
    if (kind === "template" && !template) invalid(`不明なテンプレートです: ${id}`);
    const folder = directory ?? (template ? destination(template.role) : request.folder);
    if (folder === undefined) invalid("リソースのテンプレートには作成先のfolderが必要です");
    if (!template && !resource) {
      if (request.kind !== "set") invalid(`不明なテンプレートです: ${id}`);
      // An unavailable plugin cannot supply its localized filename; use the
      // contribution's local id for the skipped placeholder. No file is created.
      const relativePath = path.posix.join(folder, `${id.split(":")[1]}.yaml`);
      safeFolder(relativePath);
      files.push({
        relativePath, kind: "resource", title: id, status: "skip", source: "",
        reason: { code: "PLUGIN_NOT_ENABLED", message: {
          ja: `プラグインが有効ではありません: ${id}`,
          en: `Plugin is not enabled: ${id}`
        } }
      });
      return;
    }
    if (resource) usedResources.push(resource);
    const resourceKind = template ? "Page" : resource!.kind;
    const namePrefix = template ? "page" : "resource";
    await ensureFolders(folder);
    const rawFilename = template
      ? customName && fileNameOf(customName) ? `${fileNameOf(customName)}.yaml` : template.fileName[language]
      : resource!.fileName[language];
    const filename = /\.ya?ml$/i.test(rawFilename) ? rawFilename : `${rawFilename}.yaml`;
    const relativePath = path.posix.join(folder, filename);
    safeFolder(relativePath);
    const exists = await observe(relativePath) || files.some(file => file.relativePath === relativePath);
    const baseName = seeds?.[identities.length] ?? identity(namePrefix);
    if (!new RegExp(`^${namePrefix}-[0-9a-hjkmnp-tv-z]{26}$`).test(baseName)) invalid("計画のIDが不正です");
    identities.push(baseName);
    let name = baseName;
    let suffix = 2;
    while (names.has(name)) name = `${baseName}-${suffix++}`;
    if (!exists) names.add(name);
    const title = customName ?? (template ?? resource)!.title[language];
    files.push({
      relativePath, kind: resourceKind, title, name,
      status: exists ? "skip" : name === baseName ? "create" : "rename",
      ...(exists ? { reason: { code: "EXISTS" as const, message: {
        ja: `同じパスが存在します: ${relativePath}`,
        en: `Path already exists: ${relativePath}`
      } } } : {}),
      source: stringify({
        apiVersion: STABLE_API_VERSION, kind: resourceKind, metadata: { name, title },
        spec: template
          ? { locale: language, blocks: [{ id: "body", type: "rich-text", content: template.body[language] }] }
          : resource!.spec[language]
      }, { lineWidth: 0, blockQuote: "literal" })
    });
  };
  if (request.kind === "set") {
    const set = catalog.sets.find(item => item.id === request.id);
    if (!set) invalid("不明なセットです");
    let directory = request.folder;
    if (set.repeat) {
      if (!request.name) invalid("繰り返しのセットには名前が必要です");
      const first = set.items.find(item => "template" in item);
      const role = first && "template" in first ? catalog.templates.find(item => item.id === first.template)!.role : "management";
      const base = destination(role);
      const slug = fileNameOf(request.name) || set.repeat.folderName[language];
      directory = path.posix.join(base, slug);
      let suffix = 2;
      while (await observe(directory)) directory = path.posix.join(base, `${slug}-${suffix++}`);
      await add("template", set.repeat.page, directory);
    }
    for (const item of set.items) {
      if ("template" in item) await add("template", item.template, directory);
      else await add("resource", item.resource, directory);
    }
  } else {
    await add(request.kind, request.id, undefined, request.name);
  }
  const plan = {
    request, files, identities,
    ...(request.guide !== undefined ? { guide: { append: request.guide } } : {})
  };
  const planHash = hash(canonical({
    plan, root, configSource, resources: usedResources,
    state: Object.entries(state).sort(([a], [b]) => a.localeCompare(b))
  }));
  return { ...plan, planHash };
}

export async function planAdd(config: LoadedConfig, request: AddRequest, options: AddOptions = {}): Promise<AddPlan> {
  return buildPlan(config, request, options);
}

export async function applyAdd(config: LoadedConfig, expected: AddPlan, options: AddOptions = {}): Promise<void> {
  let current: AddPlan;
  try {
    current = await buildPlan(config, expected.request, options, expected.identities);
  } catch (error) {
    // An ancestor may now be a file, or the configuration/root may have
    // disappeared. These are stale previews too, and must not start a write.
    throw new RuntimeError(
      `計画を再確認できません。もう一度確認してください: ${error instanceof Error ? error.message : String(error)}`,
      409, "ADD_PLAN_CONFLICT"
    );
  }
  if (current.planHash !== expected.planHash ||
      canonical(current) !== canonical(expected)) {
    throw new RuntimeError("preview後に対象が変更されました。もう一度確認してください", 409, "ADD_PLAN_CONFLICT");
  }
  const root = await realpath(config.contentRoot);
  await applyFileTransaction(root, current.files.filter(file => file.status !== "skip")
    .map(file => ({ type: "create", path: file.relativePath, content: file.source })));
}
