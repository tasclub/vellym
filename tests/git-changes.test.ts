import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile, unlink, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGitChanges, readChangeDiff, writeGitChanges, gitFailure } from "../packages/runtime-node/src/git-changes.js";
import { readGitHistory } from "../packages/runtime-node/src/git-history.js";
import { startDevServer } from "../packages/runtime-node/src/server.js";

const exec = promisify(execFile);
const dirs: string[] = [];
async function git(cwd: string, ...args: string[]) { return (await exec("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout.trim(); }
async function fixture() {
  const repo = await mkdtemp("/tmp/opencode/changes-"); dirs.push(repo);
  const root = path.join(repo, "content"); await mkdir(root);
  await git(repo, "init", "-q");
  await git(repo, "config", "user.name", "Tester"); await git(repo, "config", "user.email", "test@example.test");
  await git(repo, "config", "commit.gpgSign", "false");
  for (const name of ["one.yaml", "two.yaml", "delete.yaml", "move.yaml"]) await writeFile(path.join(root, name), `${name === "move.yaml" ? "move" : "one"}\ntwo\nthree\n`);
  await writeFile(path.join(repo, "outside"), "outside\n"); await git(repo, "add", "."); await git(repo, "commit", "-qm", "initial");
  return { repo, root };
}
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe("content-root Git writes", () => {
  it("commits only selected worktree paths, including new/deleted/renamed paths, and preserves unrelated staged files", async () => {
    const { repo, root } = await fixture();
    await writeFile(path.join(root, "one.yaml"), "changed\n");
    await writeFile(path.join(root, "two.yaml"), "staged inside\n");
    await writeFile(path.join(repo, "outside"), "staged outside\n");
    await git(repo, "add", "content/two.yaml", "outside");
    await unlink(path.join(root, "delete.yaml")); await git(repo, "add", "content/delete.yaml");
    await git(repo, "mv", "content/move.yaml", "content/renamed.yaml");
    const odd = "新\n--new.yaml"; await writeFile(path.join(root, odd), "new\n");
    const status = await readGitChanges(root); expect(status).toMatchObject({ available: true });
    if (!status.available) throw new Error("missing status");
    expect(status.files).toContainEqual({ path: "renamed.yaml", oldPath: "move.yaml", status: "R" });
    expect(status.files.some((f) => f.path === "outside")).toBe(false);
    expect(await readChangeDiff(root, "delete.yaml")).toMatchObject({ available: true, diff: expect.stringContaining("-one") });
    expect(await readChangeDiff(root, odd)).toMatchObject({ diff: expect.stringContaining("+new") });
    const result = await writeGitChanges(root, "commit", { message: "-m\nsubject argument stays literal", paths: ["one.yaml", "delete.yaml", "renamed.yaml", odd] });
    expect(result).toMatchObject({ ok: true, hash: expect.stringMatching(/^[a-f0-9]{40}$/) });
    expect(await git(repo, "show", "HEAD:outside")).toBe("outside");
    expect(await git(repo, "show", "HEAD:content/two.yaml")).toBe("one\ntwo\nthree");
    expect(await git(repo, "diff", "--cached", "--name-only")).toBe("content/two.yaml\noutside");
    expect(await git(repo, "show", `HEAD:content/${odd}`)).toBe("new");
    expect(await git(repo, "show", "HEAD:content/renamed.yaml")).toBe("move\ntwo\nthree");
  });
  it("rejects traversal, magic pathspecs, symlinks, stale paths and empty input; reports missing author without committing", async () => {
    const { repo, root } = await fixture();
    await symlink(path.join(repo, "outside"), path.join(root, "link"));
    await symlink(repo, path.join(root, "dirlink"));
    const head = await git(repo, "rev-parse", "HEAD");
    for (const name of ["../outside", "/outside", "dirlink/outside", "link", ":(top)**", "two.yaml"]) {
      await expect(writeGitChanges(root, "commit", { message: "bad", paths: [name] })).rejects.toThrow();
    }
    await expect(readChangeDiff(root, "../outside")).rejects.toThrow();
    await expect(writeGitChanges(root, "commit", { message: "", paths: ["one.yaml"] })).rejects.toThrow();
    await expect(writeGitChanges(root, "commit", { message: "a", paths: [] })).rejects.toThrow();
    await writeFile(path.join(root, "one.yaml"), "changed");
    await git(repo, "config", "user.name", "");
    expect(await writeGitChanges(root, "commit", { message: "a", paths: ["one.yaml"] })).toEqual({ ok: false, code: "author" });
    expect(await git(repo, "rev-parse", "HEAD")).toBe(head);
    expect((await readGitChanges(root))).not.toMatchObject({ files: expect.arrayContaining([expect.objectContaining({ path: "link" })]) });
  });
  it("pushes to the configured upstream using a local bare remote and distinguishes rejection and no upstream", async () => {
    const { repo, root } = await fixture();
    expect(await writeGitChanges(root, "push", {})).toEqual({ ok: false, code: "noUpstream" });
    const remote = await mkdtemp("/tmp/opencode/remote-"); dirs.push(remote); await git(remote, "init", "--bare", "-q");
    const branch = await git(repo, "branch", "--show-current");
    await git(repo, "remote", "add", "origin", remote); await git(repo, "push", "-u", "origin", branch);
    await writeFile(path.join(root, "one.yaml"), "local\n");
    expect(await writeGitChanges(root, "commit", { message: "local", paths: ["one.yaml"] })).toMatchObject({ ok: true });
    expect(await readGitChanges(root)).toMatchObject({ ahead: 1, upstream: `origin/${branch}` });
    expect(await writeGitChanges(root, "push", {})).toEqual({ ok: true });
    expect(await readGitChanges(root)).toMatchObject({ ahead: 0 });
    const clone = await mkdtemp("/tmp/opencode/clone-"); dirs.push(clone);
    await git(clone, "clone", "-q", "-b", branch, remote, ".");
    await writeFile(path.join(clone, "new"), "remote\n"); await git(clone, "add", ".");
    await git(clone, "-c", "user.name=Other", "-c", "user.email=other@example.test", "-c", "commit.gpgSign=false", "commit", "-qm", "remote");
    await git(clone, "push");
    await writeFile(path.join(root, "one.yaml"), "local again\n"); await writeGitChanges(root, "commit", { message: "diverge", paths: ["one.yaml"] });
    expect(await writeGitChanges(root, "push", {})).toMatchObject({ ok: false, code: "rejected", details: expect.any(String) });
    expect(gitFailure({ stderr: "fatal: could not read Username: terminal prompts disabled" })).toMatchObject({ code: "authentication" });
    expect(gitFailure({ stderr: "unknown" })).toMatchObject({ code: "failed" });
    expect(await readFile(path.join(clone, "new"), "utf8")).toBe("remote\n");
  });
  it("paginates recent commits in batches of 30", async () => {
    const { repo, root } = await fixture();
    for (let n = 0; n < 31; n++) { await writeFile(path.join(root, "one.yaml"), String(n)); await git(repo, "add", "."); await git(repo, "commit", "-qm", `commit ${n}`); }
    const first = await readGitHistory(root, "recent", new URLSearchParams({ limit: "30" })) as { commits: unknown[]; nextOffset: number };
    const second = await readGitHistory(root, "recent", new URLSearchParams({ limit: "30", offset: String(first.nextOffset) })) as { commits: unknown[]; nextOffset: null };
    expect(first.commits).toHaveLength(30); expect(second.commits).toHaveLength(2); expect(second.nextOffset).toBeNull();
  });
  it("keeps the last staged deletion available and retains the deleted document's title", async () => {
    const { repo, root } = await fixture();
    for (const file of ["two.yaml", "delete.yaml", "move.yaml"]) await git(repo, "rm", `content/${file}`);
    await writeFile(path.join(root, "one.yaml"), "metadata:\n  title: Deleted title\n");
    await git(repo, "add", "."); await git(repo, "commit", "-qm", "single document");
    await git(repo, "rm", "content/one.yaml");
    expect(await readGitChanges(root)).toMatchObject({ available: true, files: [{ path: "one.yaml", status: "D", title: "Deleted title" }] });
    expect(await writeGitChanges(root, "commit", { message: "delete last", paths: ["one.yaml"] })).toMatchObject({ ok: true });
  });
  it("does not disclose or commit the outside half of a boundary-crossing rename", async () => {
    const { repo, root } = await fixture();
    await git(repo, "mv", "outside", "content/incoming.yaml");
    expect(await readGitChanges(root)).toMatchObject({ files: [{ path: "incoming.yaml", status: "A" }] });
    expect(await writeGitChanges(root, "commit", { message: "inside only", paths: ["incoming.yaml"] })).toMatchObject({ ok: true });
    expect(await git(repo, "show", "HEAD:outside")).toBe("outside");
    expect(await git(repo, "diff", "--cached", "--name-only")).toBe("outside");
  });
  it("routes writes through the shared Origin and Host guards", async () => {
    const { repo, root } = await fixture();
    const configPath = path.join(repo, "vellym.config.yaml");
    await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist/vellym\nui:\n  language: ja\nplugins: []\n');
    await writeFile(path.join(root, "one.yaml"), "changed\n");
    const server = await startDevServer({ configPath, uiRoot: repo, port: 0 });
    try {
      for (const operation of ["commit", "push"]) {
        expect((await fetch(`${server.url}/api/v1/git/${operation}`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ message: "bad", paths: ["one.yaml"] }) })).status).toBe(403);
      }
      expect((await fetch(`${server.url}/api/v1/git/status`)).status).toBe(200);
      const response = await fetch(`${server.url}/api/v1/git/commit`, { method: "POST", headers: { Origin: server.url, "Content-Type": "application/json" }, body: JSON.stringify({ message: "safe", paths: ["one.yaml"] }) });
      expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ data: { ok: true } });
    } finally { await server.close(); }
  });
});
