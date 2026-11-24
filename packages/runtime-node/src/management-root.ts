import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { validateConfig } from "@vellym-internal/core";

const cache = new Map<string, { mtimeMs: number; directories: string[] }>();

/** Discover management-root exclusions without changing repository callers. */
export async function excludedDirectoriesFor(contentRoot: string): Promise<string[]> {
  const root = path.resolve(contentRoot);
  const configPath = path.join(root, "vellym.config.yaml");
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(configPath)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    cache.delete(root);
    return [];
  }
  let cached = cache.get(root);
  if (!cached || cached.mtimeMs !== mtimeMs) {
    const { config } = validateConfig(parse(await readFile(configPath, "utf8")), configPath);
    const directories = config && path.resolve(root, config.contentRoot ?? ".") === root
      ? [
          path.resolve(root, config.outputDir ?? "dist"),
          path.resolve(root, config.assets?.root ?? "assets")
        ]
      : [];
    cached = { mtimeMs, directories };
    cache.set(root, cached);
  }
  // Match loadConfig's existing environment override, including changes between calls.
  return cached.directories.map((directory, index) =>
    index === 1 && process.env.VELLYM_ASSETS_DIR
      ? path.resolve(root, process.env.VELLYM_ASSETS_DIR)
      : directory
  );
}
