import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, parseDocument } from "yaml";
import { validateConfig } from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";
import type { LoadedConfig } from "./types.js";
import { loadRepository } from "./repository.js";

export interface ContentRootPlan {
  contentRoot: string;
  resolvedContentRoot: string;
  exists: boolean;
  pages: number;
  diagnostics: number;
  planHash: string;
}

function relativeContentRoot(value: string): string {
  const normalized = value.normalize("NFC").replace(/\/+$/g, "");
  if (
    !normalized ||
    normalized === "." ||
    path.isAbsolute(normalized) ||
    normalized.includes("\\") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new RuntimeError(
      "contentRootはproject root内の相対pathで指定してください",
      400,
      "CONTENT_ROOT"
    );
  }
  return normalized;
}

export async function planContentRootChange(
  configPath: string,
  value: string
): Promise<ContentRootPlan> {
  const absoluteConfig = path.resolve(configPath);
  const projectRoot = path.dirname(absoluteConfig);
  const contentRoot = relativeContentRoot(value);
  const resolvedContentRoot = path.resolve(projectRoot, contentRoot);
  const source = await readFile(absoluteConfig, "utf8");
  let exists = true;
  let pages = 0;
  let diagnostics = 0;
  try {
    const repository = await loadRepository(resolvedContentRoot);
    pages = repository.pages.length;
    diagnostics = repository.diagnostics.length;
  } catch (error) {
    if (error instanceof RuntimeError && error.code === "CONTENT_ROOT_NOT_FOUND") {
      exists = false;
    } else {
      throw error;
    }
  }
  return {
    contentRoot,
    resolvedContentRoot,
    exists,
    pages,
    diagnostics,
    planHash: createHash("sha256")
      .update(`${source}\0${contentRoot}`)
      .digest("hex")
  };
}

export async function applyContentRootChange(
  configPath: string,
  expected: ContentRootPlan
): Promise<{ previousSource: string }> {
  const current = await planContentRootChange(configPath, expected.contentRoot);
  if (current.planHash !== expected.planHash) {
    throw new RuntimeError(
      "preview後に設定が変更されました。もう一度確認してください",
      409,
      "CONFIG_PLAN_CONFLICT"
    );
  }
  const previousSource = await readFile(configPath, "utf8");
  const document = parseDocument(previousSource, { keepSourceTokens: true });
  if (document.errors.length) {
    throw new RuntimeError(document.errors[0]!.message, 422, "CONFIG_YAML");
  }
  document.set("contentRoot", current.contentRoot);
  await mkdir(current.resolvedContentRoot, { recursive: true });
  const temporary = path.join(
    path.dirname(configPath),
    `.vellym.config-${process.pid}-${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await writeFile(temporary, document.toString({ lineWidth: 0 }), {
      encoding: "utf8",
      flag: "wx"
    });
    await loadConfig(temporary);
    await rename(temporary, configPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { previousSource };
}

export async function applyUiLanguage(
  configPath: string,
  language: "ja" | "en"
): Promise<{ previousSource: string }> {
  const previousSource = await readFile(configPath, "utf8");
  const document = parseDocument(previousSource, { keepSourceTokens: true });
  if (document.errors.length) {
    throw new RuntimeError(document.errors[0]!.message, 422, "CONFIG_YAML");
  }
  document.setIn(["ui", "language"], language);
  const temporary = path.join(
    path.dirname(configPath),
    `.vellym.config-${process.pid}-${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await writeFile(temporary, document.toString({ lineWidth: 0 }), {
      encoding: "utf8",
      flag: "wx"
    });
    await loadConfig(temporary);
    await rename(temporary, configPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { previousSource };
}

export async function loadConfig(
  configPath = path.resolve(process.cwd(), "vellym.config.yaml")
): Promise<LoadedConfig> {
  const absoluteConfig = path.resolve(configPath);
  let source: string;
  try {
    source = await readFile(absoluteConfig, "utf8");
  } catch {
    throw new RuntimeError(
      `設定ファイルが見つかりません: ${absoluteConfig}`,
      400,
      "CONFIG_NOT_FOUND"
    );
  }
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    throw new RuntimeError(
      `設定YAMLを読み込めません: ${error instanceof Error ? error.message : String(error)}`,
      400,
      "CONFIG_YAML"
    );
  }
  const result = validateConfig(value, absoluteConfig);
  if (!result.config) {
    throw new RuntimeError(
      result.diagnostics.map((item) => `${item.path}: ${item.message}`).join("\n"),
      400,
      "CONFIG_SCHEMA"
    );
  }
  const projectRoot = path.dirname(absoluteConfig);
  if (
    path.isAbsolute(result.config.contentRoot) ||
    result.config.contentRoot === "." ||
    result.config.contentRoot.includes("\\") ||
    result.config.contentRoot.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new RuntimeError(
      "contentRootはproject root内の相対pathで指定してください",
      400,
      "CONTENT_ROOT"
    );
  }
  const contentRoot = path.resolve(projectRoot, result.config.contentRoot);
  const outputDir = path.resolve(projectRoot, result.config.outputDir);
  if (!isInside(projectRoot, contentRoot)) {
    throw new RuntimeError("contentRootはプロジェクト内を指定してください", 400, "CONTENT_ROOT");
  }
  if (
    !isInside(projectRoot, outputDir) ||
    outputDir === contentRoot ||
    isInside(contentRoot, outputDir)
  ) {
    throw new RuntimeError(
      "outputDirはプロジェクト内かつcontentRoot外を指定してください",
      400,
      "OUTPUT_DIR"
    );
  }
  return {
    config: result.config,
    configPath: absoluteConfig,
    projectRoot,
    contentRoot,
    outputDir
  };
}
