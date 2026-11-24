import { stat } from "node:fs/promises";
import path from "node:path";

export interface ConfigDiscovery {
  path?: string;
  candidates: string[];
}

const CONFIG_PATHS = [
  "vellym.config.yaml",
  path.join("docs", "vellym.config.yaml"),
  path.join("vellym", "vellym.config.yaml")
] as const;

/**
 * Finds Vellym's config in the current directory or the two supported
 * management-root directories. Discovery intentionally does not walk parents.
 */
export async function discoverConfig(cwd: string): Promise<ConfigDiscovery> {
  const candidates: string[] = [];
  for (const relativePath of CONFIG_PATHS) {
    const candidate = path.resolve(cwd, relativePath);
    try {
      if ((await stat(candidate)).isFile()) candidates.push(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
  }

  return {
    ...(candidates.length === 1 ? { path: candidates[0] } : {}),
    candidates
  };
}
