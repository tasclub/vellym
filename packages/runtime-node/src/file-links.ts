import { lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "@vellym-internal/core";
import type { LoadedConfig, RepositorySnapshot } from "./types.js";

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function diagnoseFileLinks(config: LoadedConfig, snapshot: RepositorySnapshot): Promise<Diagnostic[]> {
  const references = snapshot.pages.flatMap((page) => (page.fileLinks ?? []).map((link) => ({ ...link, file: page.relativePath })));
  if (!references.length) return [];
  const root = await realpath(config.projectRoot);
  const contentRoot = await realpath(config.contentRoot);
  const diagnostics: Diagnostic[] = [];
  for (const reference of references) {
    let target: string;
    try { target = decodeURIComponent(reference.target.split(/[?#]/, 1)[0]!); }
    catch { continue; }
    if (!target || target.includes("\0")) continue;
    const resolved = path.resolve(contentRoot, path.dirname(reference.file), target);
    // Do not probe a lexically external path, even if it might point back inside.
    if (!inside(root, resolved)) continue;
    // Resolve one component at a time, so an outward symlink is never traversed.
    let parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
    let current = root;
    let missing = false;
    let followed = 0;
    while (parts.length) {
      const part = parts.shift()!;
      try {
        const next = path.join(current, part);
        if ((await lstat(next)).isSymbolicLink()) {
          if (++followed > 40) break;
          const destination = path.resolve(current, await readlink(next));
          if (!inside(root, destination)) break;
          parts = [...path.relative(root, destination).split(path.sep).filter(Boolean), ...parts];
          current = root;
        } else {
          current = next;
        }
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) missing = true;
        break;
      }
    }
    if (missing) diagnostics.push({
      file: reference.file, path: reference.path, severity: "warning", code: "BROKEN_FILE_LINK",
      message: { ja: `リンク先のファイルがありません: ${reference.target}`, en: `Linked file does not exist: ${reference.target}` }
    });
  }
  return diagnostics;
}
