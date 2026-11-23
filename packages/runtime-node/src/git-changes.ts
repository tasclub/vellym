import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";

const exec = promisify(execFile);
async function git(cwd: string, args: string[]) {
  return (await exec("git", ["--literal-pathspecs", "-c", "core.quotePath=false", ...args], {
    cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" }
  })).stdout;
}
interface Change { path: string; status: string; oldPath?: string; title?: string }
async function context(contentRoot: string) {
  // git rm may remove the now-empty content directory. Resolve its existing ancestors
  // rather than hiding the deletion (and never relax the physical repository boundary).
  let probe = path.resolve(contentRoot);
  const missing: string[] = [];
  for (;;) {
    try { probe = await realpath(probe); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(probe) === probe) throw error;
      missing.unshift(path.basename(probe)); probe = path.dirname(probe);
    }
  }
  const root = path.join(probe, ...missing);
  const repo = (await git(probe, ["rev-parse", "--show-toplevel"])).trim();
  const prefix = path.relative(repo, root).split(path.sep).join("/");
  if (!isInside(repo, root)) throw new Error("Unavailable");
  const indexed = await git(repo, ["ls-files", "-z", "--", prefix || "."]);
  // A staged deletion of the last file still needs to be inspectable and committable.
  if (!indexed && !(await git(repo, ["ls-tree", "-r", "--name-only", "HEAD", "--", prefix || "."]))) throw new Error("Unavailable");
  const relative = (name: string) => !prefix ? name : name.startsWith(`${prefix}/`) ? name.slice(prefix.length + 1) : undefined;
  return { root, repo, prefix, relative };
}
/** Check every existing ancestor, including deleted files' parents. Never stage symlinks/submodules. */
async function safePath(root: string, name: string) {
  if (!name || name.includes("\0") || name.includes("\\") || path.isAbsolute(name) || name.split("/").some((p) => !p || p === "." || p === ".." || p === ".git")) {
    throw new RuntimeError("Invalid content path", 422, "PATH_BOUNDARY");
  }
  let current = root;
  const parts = name.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]!);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new RuntimeError("Unsafe file", 422, "UNSAFE_FILE");
      if (!isInside(root, await realpath(current))) throw new RuntimeError("Outside content root", 422, "PATH_BOUNDARY");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
async function changes(ctx: Awaited<ReturnType<typeof context>>): Promise<Change[]> {
  const tokens = (await git(ctx.repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).split("\0");
  const result: Change[] = [];
  for (let i = 0; i < tokens.length && tokens[i]; i++) {
    const xy = tokens[i]!.slice(0, 2), name = tokens[i]!.slice(3);
    const old = /[RC]/.test(xy) ? tokens[++i] : undefined;
    const inside = ctx.relative(name), oldInside = old && ctx.relative(old);
    // A cross-boundary rename is exposed only as an addition/deletion inside the root.
    const add = async (file: string, status: string, oldPath?: string) => {
      try { await safePath(ctx.root, file); if (oldPath) await safePath(ctx.root, oldPath); }
      catch { return; }
      const mode = await git(ctx.repo, ["ls-files", "-s", "--", path.posix.join(ctx.prefix, file)]);
      if (/^(120000|160000) /.test(mode)) return;
      let title: string | undefined;
      if (status === "D" && /\.ya?ml$/i.test(file)) try {
        const tree = await git(ctx.repo, ["ls-tree", "-z", "HEAD", "--", path.posix.join(ctx.prefix, file)]);
        const blob = /^(100644|100755) blob ([0-9a-f]{40})\t/.exec(tree)?.[2];
        if (blob) {
          const doc = parseDocument(await git(ctx.repo, ["cat-file", "blob", blob]), { uniqueKeys: true });
          const value: unknown = doc.getIn(["metadata", "title"]);
          if (!doc.errors.length && typeof value === "string") title = value;
        }
      } catch { /* Keep filename fallback. */ }
      result.push({ path: file, status, ...(oldPath ? { oldPath } : {}), ...(title ? { title } : {}) });
    };
    if (inside) await add(inside, /[RC]/.test(xy) && oldInside ? "R" : /D/.test(xy) ? "D" : xy === "??" || /A/.test(xy) || (old && !oldInside) ? "A" : "M", oldInside || undefined);
    else if (oldInside) await add(oldInside, "D");
  }
  return result;
}
export async function readGitChanges(root: string) {
  try {
    const ctx = await context(root);
    const branch = (await git(ctx.repo, ["branch", "--show-current"])).trim();
    let upstream = "", ahead = 0;
    try {
      upstream = (await git(ctx.repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])).trim();
      ahead = Number((await git(ctx.repo, ["rev-list", "--count", "@{upstream}..HEAD"])).trim());
    } catch { /* First push belongs on the command line. */ }
    return { available: true as const, branch, upstream, ahead, files: await changes(ctx) };
  } catch { return { available: false as const }; }
}
export function gitFailure(error: unknown) {
  const details = String((error as { stderr?: string }).stderr ?? "").slice(0, 16000);
  const code = /non-fast-forward|fetch first|\[rejected\]/i.test(details) ? "rejected"
    : /authentication|permission denied|could not read Username|terminal prompts disabled|invalid username|publickey/i.test(details) ? "authentication" : "failed";
  return { ok: false as const, code, details };
}
// Serialize this server's writes so an overlapping request cannot change another selection's index.
const queues = new Map<string, Promise<unknown>>();
export async function writeGitChanges(root: string, operation: "commit" | "push", body: { message?: unknown; paths?: unknown }) {
  const key = path.resolve(root);
  const previous = queues.get(key) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    const ctx = await context(root);
    try {
      if (operation === "push") {
        let remote: string, merge: string;
        const branch = (await git(ctx.repo, ["symbolic-ref", "--short", "HEAD"])).trim();
        try {
          remote = (await git(ctx.repo, ["config", "--get", `branch.${branch}.remote`])).trim();
          merge = (await git(ctx.repo, ["config", "--get", `branch.${branch}.merge`])).trim();
          await git(ctx.repo, ["rev-parse", "--verify", "@{upstream}"]);
        } catch { return { ok: false as const, code: "noUpstream" }; }
        // Explicit refspec pushes only the current branch to its configured upstream.
        await git(ctx.repo, ["push", "--", remote, `HEAD:${merge}`]);
        return { ok: true as const };
      }
      if (typeof body.message !== "string" || !body.message.trim() || body.message.includes("\0")) throw new RuntimeError("Message required", 422, "INVALID_NAME");
      if (!Array.isArray(body.paths) || !body.paths.length || body.paths.some((p) => typeof p !== "string")) throw new RuntimeError("Selection required", 422, "INVALID_NAME");
      for (const field of ["user.name", "user.email"]) {
        try { if (!(await git(ctx.repo, ["config", "--get", field])).trim()) return { ok: false as const, code: "author" }; }
        catch { return { ok: false as const, code: "author" }; }
      }
      const current = await changes(ctx);
      const selected = new Set<string>();
      for (const name of body.paths as string[]) {
        await safePath(ctx.root, name);
        const change = current.find((f) => f.path === name);
        if (!change) throw new RuntimeError("Selection changed; refresh", 409, "INVALID_NAME");
        selected.add(path.posix.join(ctx.prefix, change.path));
        if (change.oldPath) selected.add(path.posix.join(ctx.prefix, change.oldPath));
      }
      const paths = [...selected];
      // --only ignores unrelated staged content. Intent-to-add makes new files eligible, without staging their contents.
      for (const file of paths) if (current.some((c) => c.status === "A" && path.posix.join(ctx.prefix, c.path) === file) && !(await git(ctx.repo, ["ls-files", "-z", "--", file]))) {
        await git(ctx.repo, ["add", "--intent-to-add", "--", file]);
      }
      await git(ctx.repo, ["commit", "--only", "-m", body.message, "--", ...paths]);
      return { ok: true as const, hash: (await git(ctx.repo, ["rev-parse", "HEAD"])).trim() };
    } catch (error) { if (error instanceof RuntimeError) throw error; return gitFailure(error); }
  });
  queues.set(key, job);
  try { return await job; } finally { if (queues.get(key) === job) queues.delete(key); }
}

/** Includes additions and deletions; no external diff drivers or textconv are executed. */
export async function readChangeDiff(root: string, name: string) {
  const ctx = await context(root);
  await safePath(ctx.root, name);
  const change = (await changes(ctx)).find((f) => f.path === name);
  if (!change) throw new RuntimeError("Change not found", 404, "NOT_FOUND");
  const beforePath = path.posix.join(ctx.prefix, change.oldPath ?? name);
  let before = "", after = "";
  try {
    const tree = await git(ctx.repo, ["ls-tree", "-z", "HEAD", "--", beforePath]);
    const blob = /^(100644|100755) blob ([a-f0-9]{40})\t/.exec(tree)?.[2];
    if (blob) before = await git(ctx.repo, ["cat-file", "blob", blob]);
  } catch { /* Unborn HEAD / new file. */ }
  if (change.status !== "D") after = await readFile(path.join(ctx.root, name), "utf8");
  // Reuse the same Git-generated unified format as the history viewer, without exposing absolute paths.
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const temp = await mkdtemp(path.join(tmpdir(), "vellym-changes-"));
  try {
    await writeFile(path.join(temp, "before"), before); await writeFile(path.join(temp, "after"), after);
    let diff = "";
    try { diff = await git(temp, ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--text", `--unified=${Math.max(before.split("\n").length, after.split("\n").length)}`, "--", "before", "after"]); }
    catch (error) { if ((error as { code?: number }).code !== 1) throw error; diff = (error as { stdout: string }).stdout; }
    const start = diff.indexOf("@@");
    return { available: true, diff: start < 0 ? "" : `--- a/${JSON.stringify(change.oldPath ?? name)}\n+++ b/${JSON.stringify(name)}\n${diff.slice(start)}` };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
