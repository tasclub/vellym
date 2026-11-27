import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as base, expect, cliPath } from "../fixtures.js";

// CORE-MANUAL-A01〜A03 (Core手動受入シナリオ): first start, browser setup and CLI init.
const run = (cwd: string, command: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, output: `${result.stdout}${result.stderr}` };
};
const vellym = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => run(cwd, process.execPath, [cliPath, ...args], env);
const git = (cwd: string, ...args: string[]) => {
  const result = run(cwd, "git", args);
  expect(result.status, result.output).toBe(0);
  return result.stdout;
};
const typeFolders = ["概要", "管理", "要求", "アーキテクチャ", "設計", "開発", "品質", "リリース", "運用"];

// Start from a project without any config, as `vellym dev` in an empty folder.
const test = base.extend({
  project: async ({ project }, use) => {
    await unlink(project.config);
    await unlink(project.pageFile);
    git(project.root, "init", "-q");
    await use(project);
  }
});

test("an uninitialized project opens the four-step setup inside the test folder @CORE-MANUAL-A01", async ({ page, server, project }) => {
  await page.goto(server);
  const progress = page.getByTestId("setup-progress").getByRole("listitem");
  await expect(progress).toHaveCount(4);
  // Documents, search and structure management are not available before setup.
  await expect(page.getByRole("treegrid", { name: "文書", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全文検索を開く" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open full-text search" })).toHaveCount(0);
  const root = await realpath(project.root);
  const where = await page.getByTestId("setup-absolute-path").innerText();
  expect([path.join(project.root, "docs"), path.join(root, "docs")]).toContain(where);
  // Back and forward keep the choices.
  await page.getByTestId("setup-language").selectOption("ja");
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-structure-by-phase").check();
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-back").click();
  await page.getByTestId("setup-back").click();
  await expect(page.getByTestId("setup-language")).toHaveValue("ja");
  await expect(page.getByTestId("setup-root-docs")).toBeChecked();
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-structure-by-phase")).toBeChecked();
  // Nothing is written while choosing.
  expect(await readdir(project.root)).not.toContain("docs");
});

test("the recommended browser setup creates docs/ only and validate finds it @CORE-MANUAL-A02", async ({ page, server, project }) => {
  const before = await readdir(project.root);
  await page.goto(server);
  await page.getByTestId("setup-language").selectOption("ja");
  await expect(page.getByTestId("setup-root-docs")).toBeChecked();
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-structure-by-type")).toBeChecked();
  await expect(page.getByTestId("setup-numbered")).not.toBeChecked();
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-next").click();
  for (const file of ["docs/vellym.config.yaml", "docs/VELLYM.md", "docs/index.yaml", "docs/.gitignore", "package.json", "docs/要求/_index.yaml"]) {
    await expect(page.getByTestId("setup-files-create")).toContainText(file);
  }
  // Go back one step and return: the choices are kept.
  await page.getByTestId("setup-back").click();
  await page.getByTestId("setup-back").click();
  await expect(page.getByTestId("setup-structure-by-type")).toBeChecked();
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-create")).toBeEnabled();
  expect(await readdir(project.root)).toEqual(before);
  await page.getByTestId("setup-create").click();
  await expect(page.getByTestId("setup-wizard")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "文書の入口" })).toBeVisible();
  const tree = page.getByRole("treegrid", { name: "文書", exact: true });
  for (const folder of typeFolders) await expect(tree.getByText(folder, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/commit済み|committed/i)).toHaveCount(0);

  // Only docs/ and package.json are new; no static HTML; nothing committed.
  expect((await readdir(project.root)).filter(name => !before.includes(name)).sort()).toEqual(["docs", "package.json"]);
  const docs = await readdir(path.join(project.root, "docs"));
  expect(docs).toEqual(expect.arrayContaining(["vellym.config.yaml", "VELLYM.md", "要求"]));
  expect(docs).not.toContain("dist");
  expect(git(project.root, "status", "--short")).toContain("docs/");
  expect(run(project.root, "git", ["rev-parse", "--verify", "HEAD"]).status).not.toBe(0);

  const validate = vellym(project.root, ["validate", "--json"]);
  expect(validate.status, validate.output).toBe(0);
  const repository = await (await page.request.get(`${server}/api/v1/repository`)).json();
  expect(JSON.parse(validate.stdout).data.pages.length).toBe(repository.data.pages.length);
});

test("CLI init previews skips, never overwrites, and rejects removed arguments @CORE-MANUAL-A03", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vellym-core-a03-")));
  // The scenario runs in the tester's Japanese environment after the Japanese setup of A02.
  const ja = { LC_ALL: "", LC_MESSAGES: "", LANG: "ja_JP.UTF-8" };
  try {
    git(root, "init", "-q");
    git(root, "config", "user.name", "Acceptance");
    git(root, "config", "user.email", "acceptance@example.invalid");
    git(root, "config", "commit.gpgSign", "false");
    const first = vellym(root, ["init"], ja);
    expect(first.status, first.output).toBe(0);
    git(root, "add", ".");
    git(root, "commit", "-qm", "manual acceptance baseline");
    const baseline = git(root, "rev-parse", "HEAD");
    expect(git(root, "status", "--short")).toBe("");

    const preview = vellym(root, ["init", "--dry-run", "--json"], ja);
    expect(preview.status, preview.output).toBe(0);
    const plan = JSON.parse(preview.stdout) as { files: Array<{ relativePath: string; status: string }> };
    expect(plan.files.length).toBeGreaterThan(0);
    expect(plan.files.filter(file => file.status !== "skip")).toEqual([]);
    expect(git(root, "status", "--short")).toBe("");

    const again = vellym(root, ["init"], ja);
    expect(again.status, again.output).toBe(0);
    expect(git(root, "status", "--short")).toBe("");

    const removed = vellym(root, ["init", "--size", "personal", "--method", "hybrid"], ja);
    expect(removed.status, removed.output).toBe(2);
    expect(removed.output).toMatch(/--root|--structure/);
    expect(git(root, "status", "--short")).toBe("");
    expect(git(root, "rev-parse", "HEAD")).toBe(baseline);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
