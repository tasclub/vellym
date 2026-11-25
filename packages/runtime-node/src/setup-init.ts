import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { STABLE_API_VERSION } from "@vellym-internal/core";
import { loadCatalog } from "./catalog/load.js";
import type { FolderDef } from "./catalog/types.js";
import { RuntimeError } from "./errors.js";
import { applyFileTransaction, checkFileBoundary, fileHash, type FileOp } from "./file-transaction.js";
import { packageNameFrom } from "./setup.js";
import { vellymGuide } from "./vellym-guide.js";

export interface InitRequest {
  root: "docs" | "vellym" | ".";
  structure: "by-type" | "by-phase" | "by-feature";
  numbered: boolean;
  folderNames?: Record<string, string>;
  supplementGuide?: boolean;
  language: "ja" | "en";
  plugins: Array<string | { name: string; version: string; id?: string }>;
  guideSections?: Array<{ id: string; title: string; body: string }>;
  hostVersion?: string;
}
export interface InitPlanFile {
  /** Relative to projectRoot (including the management root prefix). */
  relativePath: string;
  status: "create" | "skip" | "update";
  source: string;
  reason?: string;
  expectedHash?: string;
}
export interface InitPlan {
  projectRoot: string;
  request: InitRequest;
  files: InitPlanFile[];
  planHash: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function invalid(): never { throw new RuntimeError("初期設定の指定が不正です", 400, "SETUP_INPUT"); }

async function hostVersion(): Promise<string> {
  // In the CLI bundle ../package.json is vellym's manifest; in the
  // workspace runtime-node has no version, so use its sibling CLI manifest.
  for (const relative of ["../package.json", "../../vellym/package.json"]) {
    try {
      const manifest = JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
      if (manifest.name === "vellym" && typeof manifest.version === "string") return manifest.version;
    } catch { /* Try the workspace location. */ }
  }
  throw new Error("Cannot determine the Vellym version");
}

export async function planInit(projectRoot: string, input: InitRequest): Promise<InitPlan> {
  if (!input || !["docs", "vellym", "."].includes(input.root) ||
      !["by-type", "by-phase", "by-feature"].includes(input.structure) ||
      !["ja", "en"].includes(input.language) || typeof input.numbered !== "boolean" ||
      (input.supplementGuide !== undefined && typeof input.supplementGuide !== "boolean") ||
      !Array.isArray(input.plugins) ||
      (input.folderNames !== undefined && (!input.folderNames || typeof input.folderNames !== "object" || Array.isArray(input.folderNames)))) invalid();
  const request: InitRequest = JSON.parse(JSON.stringify(input));
  const plugins = request.plugins.map(plugin => typeof plugin === "string" ? { name: plugin, version: "*" } : plugin);
  if (plugins.some(plugin => !plugin || typeof plugin.name !== "string" ||
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(plugin.name) ||
      typeof plugin.version !== "string" || !plugin.version.trim())) invalid();
  const version = request.hostVersion ?? await hostVersion();
  if (typeof version !== "string" || !version.trim()) invalid();
  projectRoot = await realpath(projectRoot);
  const prefix = request.root === "." ? "" : `${request.root}/`;
  const files: InitPlanFile[] = [];
  const state: Record<string, string> = {};
  const observe = async (relative: string): Promise<Buffer | undefined> => {
    await checkFileBoundary(projectRoot, relative);
    // Include ancestor identities in the hash, not just the final file.
    let current = "";
    for (const part of relative.split("/")) {
      current = current ? `${current}/${part}` : part;
      try {
        const info = await lstat(path.join(projectRoot, current));
        state[current] = `${info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file"}:${await realpath(path.join(projectRoot, current))}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        state[current] = "missing";
        return undefined;
      }
    }
    const info = await lstat(path.join(projectRoot, relative));
    if (info.isDirectory()) return Buffer.from("directory");
    const source = await readFile(path.join(projectRoot, relative));
    state[relative] += `:${fileHash(source)}`;
    return source;
  };
  const add = async (relativePath: string, source: string) => {
    if (files.some(file => file.relativePath === relativePath)) invalid();
    const existing = await observe(relativePath);
    files.push({ relativePath, source, status: existing === undefined ? "create" : "skip" });
  };
  const catalog = loadCatalog();
  const definition = catalog.structures.find(item => item.id === request.structure)!;
  const structures = [definition, ...(request.supplementGuide ? catalog.structures.filter(item => item.supplement) : [])];
  const map: string[] = [];
  const names: Record<string, string> = { ...request.folderNames };
  const validIds = new Set<string>();
  const visit = async (folders: FolderDef[], parent = ""): Promise<void> => {
    for (const [index, folder] of folders.entries()) {
      validIds.add(folder.id);
      const label = names[folder.id] ?? `${request.numbered ? `${String(index).padStart(2, "0")}_` : ""}${folder.name[request.language]}`;
      if (typeof label !== "string" || !label.trim() || label.startsWith(".") || /[/\\\0\r\n]/.test(label)) invalid();
      names[folder.id] = label;
      const directory = parent ? `${parent}/${label}` : label;
      map.push(`- \`${directory}/\`: ${folder.description[request.language]}`);
      await add(`${prefix}${directory}/_index.yaml`, stringify({
        apiVersion: STABLE_API_VERSION, kind: "Folder", metadata: { title: label },
        spec: { locale: request.language, order: [] }
      }));
      await visit(folder.children ?? [], directory);
    }
  };
  let supplementMap: string[] = [];
  for (const structure of structures) {
    const start = map.length;
    await visit(structure.folders);
    if (structure.supplement) supplementMap = map.slice(start);
  }
  if (Object.keys(request.folderNames ?? {}).some(id => !validIds.has(id))) invalid();
  await add(`${prefix}vellym.config.yaml`, stringify({
    schemaVersion: "1.0", ui: { language: request.language }, plugins: plugins.map(plugin => plugin.name),
    setup: { structure: request.structure, numbered: request.numbered,
      ...(request.folderNames ? { folderNames: request.folderNames } : {}) }
  }));
  let guide = vellymGuide({
    language: request.language, structure: request.structure, numbered: request.numbered,
    folderNames: names, plugins: plugins.map(plugin => ({ id: plugin.id ?? plugin.name, name: plugin.name })), sections: request.guideSections, version
  });
  if (supplementMap.length) {
    // Keep the supplement in the document map, before the workflow section.
    const heading = request.language === "ja" ? "## 2. 作業の流れ" : "## 2. Workflow";
    guide = guide.replace(heading, `${supplementMap.join("\n")}\n\n${heading}`);
  }
  await add(`${prefix}VELLYM.md`, guide);
  const ja = request.language === "ja";
  await add(`${prefix}index.yaml`, stringify({
    apiVersion: STABLE_API_VERSION, kind: "Page",
    metadata: { name: "vellym-index", title: ja ? "文書の入口" : "Documentation" },
    spec: { locale: request.language, blocks: [{ id: "body", type: "rich-text", format: "commonmark",
      content: `## ${ja ? "文書の地図" : "Document map"}\n\n${map.join("\n")}\n\n${ja ? "必要な文書だけ「テンプレートから作る」で追加してください。作業の流れはVELLYM.mdを参照してください。" : 'Use "Create from template" to add only the documents you need. See VELLYM.md for the workflow.'}\n` }] }
  }, { lineWidth: 0 }));
  await add(`${prefix}.gitignore`, "dist/\n");
  const existing = await observe("package.json");
  let pkg: Record<string, unknown>;
  try {
    pkg = existing ? JSON.parse(existing.toString("utf8")) as Record<string, unknown> : {
      name: packageNameFrom(projectRoot), version: "0.0.0", private: true, type: "module"
    };
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error();
    for (const field of ["dependencies", "devDependencies"]) {
      if (pkg[field] !== undefined && (!pkg[field] || typeof pkg[field] !== "object" || Array.isArray(pkg[field]))) throw new Error();
    }
  } catch {
    files.push({ relativePath: "package.json", status: "skip", source: "", reason: "unreadable-json" });
    const plan = { projectRoot, request, files };
    return { ...plan, planHash: fileHash(canonical({ plan, state })) };
  }
  const dependencies = { ...pkg.dependencies as Record<string, string> };
  const devDependencies = { ...pkg.devDependencies as Record<string, string> };
  for (const plugin of plugins) {
    if (!(plugin.name in dependencies) && !(plugin.name in devDependencies)) dependencies[plugin.name] = plugin.version === "*" ? "*" : `^${plugin.version.replace(/^\^/, "")}`;
  }
  if (!("vellym" in dependencies) && !("vellym" in devDependencies)) devDependencies.vellym = `^${version}`;
  if (Object.keys(dependencies).length) pkg.dependencies = dependencies;
  if (Object.keys(devDependencies).length) pkg.devDependencies = devDependencies;
  files.push({ relativePath: "package.json", status: existing ? "update" : "create",
    source: `${JSON.stringify(pkg, null, 2)}\n`, ...(existing ? { expectedHash: fileHash(existing) } : {}) });
  const plan = { projectRoot, request, files };
  return { ...plan, planHash: fileHash(canonical({ plan, state })) };
}

export async function applyInit(expected: InitPlan): Promise<void> {
  let current: InitPlan;
  try { current = await planInit(expected.projectRoot, expected.request); }
  catch { throw new RuntimeError("計画を再確認してください", 409, "SETUP_PLAN_CONFLICT"); }
  if (canonical(current) !== canonical(expected)) {
    throw new RuntimeError("計画の後に変更されました。もう一度確認してください", 409, "SETUP_PLAN_CONFLICT");
  }
  const ops: FileOp[] = current.files.filter(file => file.status !== "skip").map(file =>
    file.status === "update"
      ? { type: "update", path: file.relativePath, content: file.source, expectedHash: file.expectedHash! }
      : { type: "create", path: file.relativePath, content: file.source });
  await applyFileTransaction(current.projectRoot, ops);
}
