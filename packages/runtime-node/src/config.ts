import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse, parseDocument } from "yaml";
import { validateConfig } from "@vellym-internal/core";
import { resolveLocalizedText } from "@vellym/plugin-api";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";
import type { LoadedConfig } from "./types.js";
import { loadRepository } from "./repository.js";

const execute = promisify(execFile);

async function gitRepositoryRoot(projectRoot: string): Promise<string> {
  try {
    const result = await execute("git", ["rev-parse", "--show-toplevel"], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 15_000
    });
    const root = result.stdout.trim();
    if (root) return path.resolve(projectRoot, root);
  } catch {
    // A non-Git project uses the parent of the configuration directory.
  }
  return path.dirname(projectRoot);
}

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
    path.isAbsolute(normalized) ||
    normalized.includes("\\") ||
    (normalized !== "." &&
      normalized.split("/").some((part) => !part || part === "." || part === ".."))
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
  const realProjectRoot = await realpath(projectRoot);
  let boundaryCandidate = resolvedContentRoot;
  const missingSegments: string[] = [];
  let realContentRoot: string;
  for (;;) {
    try {
      realContentRoot = path.resolve(
        await realpath(boundaryCandidate),
        ...missingSegments
      );
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ELOOP") {
        throw new RuntimeError(
          "contentRootはproject root内の相対pathで指定してください",
          400,
          "CONTENT_ROOT"
        );
      }
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;

      let info;
      try {
        info = await lstat(boundaryCandidate);
      } catch (statError) {
        const statCode = (statError as NodeJS.ErrnoException).code;
        if (statCode !== "ENOENT" && statCode !== "ENOTDIR") throw statError;
      }
      if (info?.isSymbolicLink()) {
        const target = await readlink(boundaryCandidate);
        boundaryCandidate = path.isAbsolute(target)
          ? target
          : path.resolve(path.dirname(boundaryCandidate), target);
        continue;
      }

      const parent = path.dirname(boundaryCandidate);
      if (parent === boundaryCandidate) throw error;
      missingSegments.unshift(path.basename(boundaryCandidate));
      boundaryCandidate = parent;
    }
  }
  if (
    realContentRoot !== realProjectRoot &&
    !isInside(realProjectRoot, realContentRoot)
  ) {
    throw new RuntimeError(
      "contentRootはproject root内の相対pathで指定してください",
      400,
      "CONTENT_ROOT"
    );
  }
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
  configPath = path.resolve(process.cwd(), "vellym.config.yaml"),
  locale = "ja"
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
      result.diagnostics
        .map((item) => `${item.path}: ${resolveLocalizedText(item.message, locale)}`)
        .join("\n"),
      400,
      "CONFIG_SCHEMA"
    );
  }
  const projectRoot = path.dirname(absoluteConfig);
  const config = {
    ...result.config,
    contentRoot: result.config.contentRoot ?? ".",
    outputDir: result.config.outputDir ?? "dist"
  };
  if (
    config.repositoryRoot !== undefined &&
    (path.isAbsolute(config.repositoryRoot) ||
      path.win32.isAbsolute(config.repositoryRoot) ||
      config.repositoryRoot.includes("\\") ||
      config.repositoryRoot.includes("\0"))
  ) {
    throw new RuntimeError(
      "repositoryRootは設定フォルダからの相対pathで指定してください",
      400,
      "REPOSITORY_ROOT"
    );
  }
  const repositoryRoot =
    config.repositoryRoot === undefined
      ? await gitRepositoryRoot(projectRoot)
      : path.resolve(projectRoot, config.repositoryRoot);
  if (
    path.isAbsolute(config.contentRoot) ||
    config.contentRoot.includes("\\") ||
    (config.contentRoot !== "." &&
      config.contentRoot.split("/").some((part) => part === ".." || part === "."))
  ) {
    throw new RuntimeError(
      "contentRootはproject root内の相対pathで指定してください",
      400,
      "CONTENT_ROOT"
    );
  }
  const contentRoot = path.resolve(projectRoot, config.contentRoot);
  const outputDir = path.resolve(projectRoot, config.outputDir);
  if (contentRoot !== projectRoot && !isInside(projectRoot, contentRoot)) {
    throw new RuntimeError("contentRootはプロジェクト内を指定してください", 400, "CONTENT_ROOT");
  }
  if (
    !isInside(projectRoot, outputDir) ||
    outputDir === contentRoot ||
    (contentRoot !== projectRoot &&
      (isInside(contentRoot, outputDir) || isInside(outputDir, contentRoot)))
  ) {
    throw new RuntimeError(
      "outputDirはプロジェクト内かつcontentRoot外を指定してください",
      400,
      "OUTPUT_DIR"
    );
  }
  return {
    config,
    configPath: absoluteConfig,
    projectRoot,
    repositoryRoot,
    contentRoot,
    outputDir,
    assetsRoot: path.resolve(projectRoot, process.env.VELLYM_ASSETS_DIR || result.config.assets?.root || "assets"),
    assetsMaxBytes: result.config.assets?.maxBytes ?? 10 * 1024 * 1024
  };
}
