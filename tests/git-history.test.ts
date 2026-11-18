import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readGitHistory } from "../packages/runtime-node/src/git-history.js";
import type { GitHistoryData, GitResult } from "../packages/ui-react/src/shared/api.js";

const exec = promisify(execFile);
const projects: string[] = [];
async function git(cwd: string, ...args: string[]) {
  return (await exec("git", ["-c", "user.name=History Tester", "-c", "user.email=test@example.test", "-c", "commit.gpgSign=false", ...args], { cwd })).stdout.trim();
}
async function fixture() {
  const project = await mkdtemp(path.join(tmpdir(), "vellym-history-"));
  projects.push(project);
  const root = path.join(project, "content");
  await mkdir(root);
  await git(project, "init", "-q");
  return { project, root };
}
async function commit(project: string, subject: string) {
  await git(project, "add", ".");
  await git(project, "commit", "-qm", subject);
  return git(project, "rev-parse", "HEAD");
}
function query(params: Record<string, string> = {}) {
  return new URLSearchParams({ path: "page.yaml", ...params });
}
async function history(root: string, params: Record<string, string> = {}) {
  const result = await readGitHistory(root, "history", query(params)) as GitResult<GitHistoryData>;
  if (!result.available) throw new Error("Expected Git history");
  return result;
}
afterEach(async () => { for (const project of projects.splice(0)) await rm(project, { recursive: true, force: true }); });

describe("Git history UI data extensions", () => {
  it("pages 123 commits in batches of 50 without duplicates or gaps", async () => {
    const { project, root } = await fixture();
    const hashes: string[] = [];
    for (let i = 0; i < 123; i++) {
      await writeFile(path.join(root, "page.yaml"), `version: ${i}\n`);
      hashes.push(await commit(project, `version ${i}`));
    }
    const first = await history(root);
    const second = await history(root, { offset: String(first.nextOffset) });
    const third = await history(root, { offset: String(second.nextOffset) });
    expect([first.commits.length, second.commits.length, third.commits.length]).toEqual([50, 50, 23]);
    expect([first.nextOffset, second.nextOffset, third.nextOffset]).toEqual([50, 100, null]);
    expect([...first.commits, ...second.commits, ...third.commits].map(({ hash }) => hash)).toEqual(hashes.reverse());
    expect(await history(root, { offset: "123" })).toMatchObject({ commits: [], nextOffset: null });
  }, 30_000);

  it("returns both root-relative rename paths, including unusual filename characters", async () => {
    const { project, root } = await fixture();
    const old = "元\t page.yaml";
    const next = "新\n page.yaml";
    await writeFile(path.join(root, old), "first\nsecond\n");
    const first = await commit(project, "initial");
    await git(project, "mv", `content/${old}`, `content/${next}`);
    const moved = await commit(project, "move");
    expect(await history(root, { path: next })).toMatchObject({ commits: [
      { hash: moved, rename: { from: old, to: next } }, { hash: first }
    ] });
    const older = await history(root, { path: next, offset: "1", limit: "1" });
    expect(older.commits[0]).not.toHaveProperty("rename");
  });

  it("distinguishes clean, staged, unstaged, untracked and ignored files per path", async () => {
    const { project, root } = await fixture();
    await writeFile(path.join(root, "page.yaml"), "original\n");
    await writeFile(path.join(root, "other.yaml"), "other\n");
    await writeFile(path.join(root, ".gitignore"), "ignored/\n");
    await commit(project, "initial");
    await writeFile(path.join(root, "other.yaml"), "changed\n");
    expect(await history(root)).toMatchObject({ tracked: true, uncommitted: false });
    await writeFile(path.join(root, "page.yaml"), "changed\n");
    expect(await history(root)).toMatchObject({ tracked: true, uncommitted: true });
    await git(project, "add", "content/page.yaml");
    expect(await history(root)).toMatchObject({ tracked: true, uncommitted: true });
    for (const folder of ["new", "ignored"]) {
      await mkdir(path.join(root, folder));
      await writeFile(path.join(root, folder, "page.yaml"), "new\n");
      expect(await history(root, { path: `${folder}/page.yaml` })).toMatchObject({
        tracked: false, uncommitted: folder === "new", commits: []
      });
    }
    await git(project, "add", "content/new/page.yaml");
    expect(await history(root, { path: "new/page.yaml" })).toMatchObject({ tracked: true, uncommitted: true, commits: [] });
  });

  it("compares the initial commit with empty content and returns expandable full context", async () => {
    const { project, root } = await fixture();
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`);
    const original = `${lines.join("\n")}\n`;
    await writeFile(path.join(root, "page.yaml"), original);
    const first = await commit(project, "initial");
    const diff = async (params: Record<string, string>) => {
      const result = await readGitHistory(root, "diff", query(params)) as { available: boolean; diff: string };
      expect(result.available).toBe(true);
      return result.diff;
    };
    const initial = await diff({ from: "", to: first });
    expect(initial).toContain("@@ -0,0 +1,80 @@");
    expect(initial.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"))).toHaveLength(80);
    lines[19] = "changed 20";
    lines[59] = "changed 60";
    await writeFile(path.join(root, "page.yaml"), `${lines.join("\n")}\n`);
    const compact = await diff({});
    expect(compact).toEqual(await diff({ context: "3" }));
    expect(compact).not.toContain(" line 1\n");
    const full = await diff({ context: "all" });
    // These returned context lines suffice to expand leading, middle and trailing folds.
    expect(full).toContain(" line 1\n");
    expect(full).toContain(" line 40\n");
    expect(full).toContain(" line 80\n");
    expect(full).toEqual(await diff({ context: "80" }));
    const removed: string[] = [], added: string[] = [];
    for (const line of full.slice(full.indexOf("@@")).split("\n").slice(1, -1)) {
      if (line[0] === " " || line[0] === "-") removed.push(line.slice(1));
      if (line[0] === " " || line[0] === "+") added.push(line.slice(1));
    }
    expect(`${removed.join("\n")}\n`).toBe(original);
    expect(`${added.join("\n")}\n`).toBe(await readFile(path.join(root, "page.yaml"), "utf8"));
    expect(await diff({ context: "0" })).not.toContain("\n line 19\n");
    expect(await diff({ from: "", context: "all" })).toContain("+changed 20");
  });

  it("rejects malformed pagination, revisions and context", async () => {
    const { root } = await fixture();
    await writeFile(path.join(root, "page.yaml"), "data\n");
    const invalid: Array<Record<string, string>> = [{ offset: "-1" }, { offset: "9007199254740992" }, { offset: "1.5" }, { context: "-1" }, { context: "2147483648" }, { context: "--help" }, { to: "" }];
    for (const params of invalid) {
      await expect(readGitHistory(root, "diff", query(params))).rejects.toMatchObject({ status: 400, code: "INVALID_NAME" });
    }
  });
});
