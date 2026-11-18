import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, realpath, readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { projectPage, validatePage, type LocalizedPageProjection } from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";

const execute = promisify(execFile);
const hashPattern = /^[0-9a-f]{7,40}$/;
interface Commit { hash: string; date: string; author: string; subject: string }
interface Change { status: string; paths: string[] }
interface LogEntry extends Commit { changes: Change[] }

/**
 * Validates and projects a historical version on the server, so the browser never
 * bundles the Ajv compiler (ticket-01m7phrktvjrvwgekge6fq9vnh). Returns nothing for
 * malformed YAML, excessive aliases, other kinds, validation errors or a locale the
 * version does not publish.
 */
export function historicalProjection(source: string, relativePath: string, locale: string, defaultLocale: string): LocalizedPageProjection | undefined {
  try {
    const yaml = parseDocument(source, { uniqueKeys: true });
    if (yaml.errors.length) return;
    const validated = validatePage(yaml.toJS({ maxAliasCount: 100 }), relativePath);
    if (!validated.page || validated.diagnostics.some((item) => item.severity === "error")) return;
    return projectPage(validated.page, locale, defaultLocale, relativePath);
  } catch { return; }
}

// NUL framing preserves spaces, tabs, newlines and non-ASCII filenames.
export function parseGitLog(output: string): LogEntry[] {
  const tokens = output.split("\0");
  const entries: LogEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] !== "" || !/^[0-9a-f]{40}$/.test(tokens[i + 1] ?? "")) { i++; continue; }
    const entry: LogEntry = {
      hash: tokens[i + 1]!, date: tokens[i + 2]!, author: tokens[i + 3]!,
      subject: tokens[i + 4]!, changes: []
    };
    i += 6;
    while (i < tokens.length && tokens[i] !== "") {
      const status = tokens[i++]!.replace(/^\n/, "");
      const count = /^[RC]/.test(status) ? 2 : 1;
      entry.changes.push({ status, paths: tokens.slice(i, i + count) });
      i += count;
    }
    entries.push(entry);
  }
  return entries;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execute("git", ["--literal-pathspecs", "-c", "core.quotePath=false", ...args], {
    cwd, encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  });
  return result.stdout;
}

function publicCommit(entry: Commit): Commit {
  return { hash: entry.hash, date: entry.date, author: entry.author, subject: entry.subject };
}

async function mapBounded<T, R>(values: T[], project: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(values.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(2, values.length) }, async () => {
    for (let i = index++; i < values.length; i = index++) result[i] = await project(values[i]!);
  }));
  return result;
}

export async function readGitHistory(contentRoot: string, operation: string, query: URLSearchParams): Promise<unknown> {
  const root = await realpath(contentRoot);
  const requested = query.get("path") ?? "";
  let file: string | undefined;
  if (operation !== "recent") {
    if (!requested || requested.includes("\0") || requested.split(/[/\\]/).includes("..") || path.isAbsolute(requested)) {
      throw new RuntimeError("contentRoot外のpathは利用できません", 422, "PATH_BOUNDARY");
    }
    try { file = await realpath(path.join(root, requested)); }
    catch { throw new RuntimeError("ファイルがありません", 404, "NOT_FOUND"); }
    if (!isInside(root, file)) throw new RuntimeError("contentRoot外のpathは利用できません", 422, "PATH_BOUNDARY");
    if (!(await lstat(file)).isFile()) throw new RuntimeError("通常ファイルではありません", 422, "UNSAFE_FILE");
  }
  for (const key of operation === "content" ? ["revision"] : operation === "diff" ? ["from", "to"] : []) {
    const value = query.get(key);
    if (operation === "diff" && key === "from" && value === "") continue;
    if ((operation === "content" || value !== null) && !hashPattern.test(value ?? "")) {
      throw new RuntimeError("版は7〜40桁の小文字16進hashで指定してください", 400, "INVALID_NAME");
    }
  }
  const rawLimit = query.get("limit") ?? "50";
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
    throw new RuntimeError("limitは1〜100です", 400, "INVALID_NAME");
  }
  const limit = Number(rawLimit);
  const rawOffset = query.get("offset") ?? "0";
  const rawContext = query.get("context") ?? "3";
  if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset))) {
    throw new RuntimeError("offsetは0以上の安全な整数です", 400, "INVALID_NAME");
  }
  if (rawContext !== "all" && (!/^\d+$/.test(rawContext) || !Number.isSafeInteger(Number(rawContext)) || Number(rawContext) > 2147483647)) {
    throw new RuntimeError("contextは0〜2147483647またはallです", 400, "INVALID_NAME");
  }
  const offset = Number(rawOffset);
  try {
    const repo = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
    const prefix = path.relative(repo, root).split(path.sep).join("/");
    if (prefix.startsWith("../") || path.isAbsolute(prefix)) return { available: false, reason: "unavailable" };
    const relative = (name: string): string | undefined => {
      if (name.split("/").some((part) => part === ".." || part === ".git") || name.startsWith("/")) return undefined;
      if (!prefix) return name || undefined;
      return name.startsWith(`${prefix}/`) ? name.slice(prefix.length + 1) || undefined : undefined;
    };
    const tracked = await git(repo, ["ls-files", "-z", "--", prefix || "."]);
    if (!tracked) return { available: false, reason: "unavailable" };
    const shallow = (await git(repo, ["rev-parse", "--is-shallow-repository"])).trim() === "true";
    const format = "--format=%x00%H%x00%aI%x00%an%x00%s%x00";
    if (operation === "recent") {
      // Disable rename pairing: an external source of a rename must never reach the response.
       const log = parseGitLog(await git(repo, ["log", `--skip=${offset}`, `-n${limit + 1}`, format, "--name-status", "--no-renames", "-z", "--", prefix || "."]));
       return { available: true, shallow, nextOffset: log.length > limit ? offset + limit : null, commits: await mapBounded(log.slice(0, limit), async (entry) => ({
         ...publicCommit(entry), files: await mapBounded(entry.changes.flatMap((change) => change.paths.flatMap((name) => {
           const inside = relative(name);
           return inside ? [{ path: inside, status: change.status, repoPath: name }] : [];
         })), async ({ path: filePath, status, repoPath }) => {
           let title: string | undefined;
           if (/\.ya?ml$/i.test(filePath)) try {
             const revision = status === "D" ? `${entry.hash}^` : entry.hash;
             const tree = await git(repo, ["ls-tree", "-z", revision, "--", repoPath]);
             const blob = /^(100644|100755) blob ([0-9a-f]{40})\t/.exec(tree)?.[2];
             if (blob) {
               const parsed = parseDocument(await git(repo, ["cat-file", "blob", blob]), { uniqueKeys: true });
               const value: unknown = parsed.getIn(["metadata", "title"]);
               if (!parsed.errors.length && typeof value === "string") title = value;
             }
           } catch { /* Invalid/deleted historical documents still have their filenames. */ }
           return { path: filePath, status, ...(title ? { title } : {}) };
         })
       })) };
    }
    const repoPath = path.relative(repo, file!).split(path.sep).join("/");
    const fileTracked = (await git(repo, ["ls-files", "-z", "--", repoPath])).length > 0;
    const uncommitted = (await git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", repoPath])).length > 0;
    const log = parseGitLog(await git(repo, ["log", "--first-parent", "--follow", format, "--name-status", "-z", "--", repoPath]));
    const versions: Array<Commit & { path: string; rename?: { from: string; to: string } }> = [];
    let current = repoPath;
    let boundaryTruncated = false;
    for (const entry of log) {
      if (!relative(current)) { boundaryTruncated = true; break; }
      const rename = entry.changes.find((change) => /^[RC]/.test(change.status) && change.paths[1] === current);
      const from = rename && relative(rename.paths[0]!);
      const to = rename && relative(rename.paths[1]!);
      versions.push({ ...publicCommit(entry), path: current, ...(from && to ? { rename: { from, to } } : {}) });
      if (rename) {
        current = rename.paths[0]!;
        if (!relative(current)) { boundaryTruncated = true; break; }
      }
    }
    const state = { available: true, shallow, boundaryTruncated };
    if (operation === "history") return {
      ...state, tracked: fileTracked, uncommitted,
      nextOffset: offset + limit < versions.length ? offset + limit : null,
      commits: versions.slice(offset, offset + limit).map((version) => ({
        ...publicCommit(version), ...(version.rename ? { rename: version.rename } : {})
      }))
    };
    const readVersion = async (revision: string): Promise<string> => {
      const full = (await git(repo, ["rev-parse", "--verify", `${revision}^{commit}`])).trim();
      await git(repo, ["merge-base", "--is-ancestor", full, "HEAD"]);
      for (const version of versions) {
        try { await git(repo, ["merge-base", "--is-ancestor", version.hash, full]); }
        catch { continue; }
        // Tree mode rejects historical symlinks and submodules; cat-file receives only a verified blob ID.
        const tree = await git(repo, ["ls-tree", "-z", full, "--", version.path]);
        const match = /^(100644|100755) blob ([0-9a-f]{40})\t/.exec(tree);
        if (!match) break;
        return git(repo, ["cat-file", "blob", match[2]!]);
      }
      throw new RuntimeError("この版にcontentRoot内のファイルはありません", 404, "NOT_FOUND");
    };
    if (operation === "content") {
      const source = await readVersion(query.get("revision")!);
      const locale = query.get("locale");
      const view = locale ? historicalProjection(source, requested, locale, query.get("baseLocale") || locale) : undefined;
      return { ...state, source, ...(view ? { view } : {}) };
    }
    const from = query.get("from") ?? versions[0]?.hash;
    if (from === undefined) throw new RuntimeError("コミットされた版がありません", 404, "NOT_FOUND");
    const before = from === "" ? "" : await readVersion(from);
    const after = query.has("to") ? await readVersion(query.get("to")!) : await readFile(file!, "utf8");
    const temp = await mkdtemp(path.join(tmpdir(), "vellym-git-diff-"));
    try {
      await writeFile(path.join(temp, "before"), before);
      await writeFile(path.join(temp, "after"), after);
      let diff: string;
      const context = rawContext === "all" ? Math.max(before.split("\n").length, after.split("\n").length) : Number(rawContext);
      try { diff = await git(temp, ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--text", `--unified=${context}`, "--", "before", "after"]); }
      catch (error) {
        const failure = error as { code?: number; stdout?: string };
        if (failure.code !== 1 || typeof failure.stdout !== "string") throw error;
        diff = failure.stdout;
      }
      const hunks = diff.indexOf("@@");
      // Only content-root-relative labels, never temporary/repository absolute paths.
      return { ...state, diff: hunks < 0 ? "" : `--- a/${JSON.stringify(relative(repoPath))}\n+++ b/${JSON.stringify(relative(repoPath))}\n${diff.slice(hunks)}` };
    } finally { await rm(temp, { recursive: true, force: true }); }
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    return { available: false, reason: "unavailable" };
  }
}
