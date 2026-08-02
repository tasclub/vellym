import { randomBytes } from "node:crypto";
import { readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isAlias, isNode, parseAllDocuments, parseDocument, visit } from "yaml";
import {
  API_VERSION,
  STABLE_API_VERSION,
  type Diagnostic
} from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { contentHash } from "./path-utils.js";
import { loadConfig } from "./config.js";

export interface MigrationFile {
  relativePath: string;
  kind: "Page" | "Folder";
  sourceHash: string;
}

export interface MigrationPlan {
  from: typeof API_VERSION;
  to: typeof STABLE_API_VERSION;
  configPath: string;
  contentRoot: string;
  files: MigrationFile[];
  diagnostics: Diagnostic[];
  planHash: string;
}

async function yamlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) files.push(target);
    }
  }
  await visit(root);
  return files;
}

export async function planMigration(configPath: string): Promise<MigrationPlan> {
  const loaded = await loadConfig(configPath);
  const files: MigrationFile[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const filename of await yamlFiles(loaded.contentRoot)) {
    const relativePath = path.relative(loaded.contentRoot, filename).replaceAll("\\", "/");
    const source = await readFile(filename, "utf8");
    const documents = parseAllDocuments(source, { keepSourceTokens: true });
    const document = documents[0];
    if (!document || document.errors.length || documents.length !== 1) {
      diagnostics.push({
        file: relativePath,
        severity: "error",
        code: "MIGRATION_YAML",
        message: document?.errors[0]?.message ?? "単一YAML documentではありません"
      });
      continue;
    }
    const unsafeReasons = new Set<string>();
    visit(document, (_key, node) => {
      if (isAlias(node)) unsafeReasons.add("alias");
      if (isNode(node)) {
        const annotated = node as typeof node & { anchor?: string; tag?: string };
        if (annotated.anchor) unsafeReasons.add("anchor");
        if (annotated.tag && !annotated.tag.startsWith("tag:yaml.org,2002:")) {
          unsafeReasons.add("custom tag");
        }
      }
    });
    if (unsafeReasons.size) {
      diagnostics.push({
        file: relativePath,
        severity: "error",
        code: "MIGRATION_UNSAFE_YAML",
        message: `${[...unsafeReasons].join("、")}を含むため安全にmigrationできません`
      });
      continue;
    }
    const raw = document.toJS({ maxAliasCount: 100 });
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const value = raw as Record<string, unknown>;
    if (value.apiVersion !== API_VERSION) continue;
    if (value.kind !== "Page" && value.kind !== "Folder") {
      diagnostics.push({
        file: relativePath,
        severity: "error",
        code: "MIGRATION_KIND",
        message: "v1alpha1 resourceのkindはPageまたはFolderである必要があります"
      });
      continue;
    }
    files.push({ relativePath, kind: value.kind, sourceHash: contentHash(source) });
  }
  const planHash = contentHash(
    files.map((file) => `${file.relativePath}:${file.sourceHash}`).join("\n")
  );
  return {
    from: API_VERSION,
    to: STABLE_API_VERSION,
    configPath: loaded.configPath,
    contentRoot: loaded.contentRoot,
    files,
    diagnostics,
    planHash
  };
}

async function atomicWrite(filename: string, source: string): Promise<void> {
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.vellym-migrate-${process.pid}-${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filename);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function applyMigration(
  expected: MigrationPlan
): Promise<{ migrated: number; planHash: string }> {
  const current = await planMigration(expected.configPath);
  if (current.planHash !== expected.planHash) {
    throw new RuntimeError(
      "migration preview後にcontentが変更されました。もう一度確認してください",
      409,
      "MIGRATION_PLAN_CONFLICT"
    );
  }
  if (current.diagnostics.some((item) => item.severity === "error")) {
    throw new RuntimeError(
      "読み込めないYAMLがあるためmigrationを中止しました",
      422,
      "MIGRATION_DIAGNOSTICS"
    );
  }

  const prepared: Array<{ filename: string; before: string; after: string }> = [];
  for (const file of current.files) {
    const filename = path.join(current.contentRoot, file.relativePath);
    const info = await stat(filename);
    if (!info.isFile()) {
      throw new RuntimeError("migration対象が通常ファイルではありません", 409, "MIGRATION_FILE");
    }
    const before = await readFile(filename, "utf8");
    if (contentHash(before) !== file.sourceHash) {
      throw new RuntimeError(
        `migration対象が変更されました: ${file.relativePath}`,
        409,
        "MIGRATION_FILE_CONFLICT"
      );
    }
    const document = parseDocument(before, { keepSourceTokens: true });
    document.set("apiVersion", STABLE_API_VERSION);
    const after = document.toString({ lineWidth: 0 });
    const checked = parseDocument(after);
    const value = checked.toJS() as Record<string, unknown>;
    if (
      checked.errors.length ||
      value.apiVersion !== STABLE_API_VERSION ||
      value.kind !== file.kind
    ) {
      throw new RuntimeError(
        `migration結果を検証できません: ${file.relativePath}`,
        422,
        "MIGRATION_OUTPUT"
      );
    }
    prepared.push({ filename, before, after });
  }

  const changed: typeof prepared = [];
  try {
    for (const item of prepared) {
      await atomicWrite(item.filename, item.after);
      changed.push(item);
    }
  } catch (error) {
    for (const item of changed.reverse()) await atomicWrite(item.filename, item.before);
    throw error;
  }
  return { migrated: changed.length, planHash: current.planHash };
}
