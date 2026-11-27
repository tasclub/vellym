import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as base, expect, cliPath } from "../fixtures.js";

// CORE-MANUAL-C01 (CLI preview, init, validate, build) and D01 (browser setup keeps
// an existing file) from Core手動受入シナリオ.
const run = (cwd: string, command: string, args: string[]) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, output: `${result.stdout}${result.stderr}` };
};
const vellym = (cwd: string, ...args: string[]) => run(cwd, process.execPath, [cliPath, ...args]);
const sha256 = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
async function tree(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter(file => !file.startsWith(".git/")).sort();
}

base("CLI preview writes nothing, init creates the preview, validate and build pass @CORE-MANUAL-C01", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vellym-core-c01-")));
  try {
    expect(run(root, "git", ["init", "-q"]).status).toBe(0);
    const preview = vellym(root, "init", "--structure", "by-phase", "--language", "ja", "--dry-run", "--json");
    expect(preview.status, preview.output).toBe(0);
    expect(await tree(root)).toEqual([]);
    const planned = (JSON.parse(preview.stdout) as { files: Array<{ relativePath: string; status: string }> }).files
      .filter(file => file.status !== "skip").map(file => file.relativePath).sort();

    const apply = vellym(root, "init", "--structure", "by-phase", "--language", "ja");
    expect(apply.status, apply.output).toBe(0);
    expect(await tree(root)).toEqual(planned);
    const docs = await readdir(path.join(root, "docs"));
    // Numbered phase folders 00_プロジェクト管理 … 07_運用.
    const numbered = docs.filter(name => /^0[0-7]_/.test(name)).sort();
    expect(numbered).toHaveLength(8);
    expect(numbered[0]).toBe("00_プロジェクト管理");
    expect(numbered.at(-1)).toBe("07_運用");
    expect(docs).not.toContain("dist");

    const validate = vellym(root, "validate", "--json");
    expect(validate.status, validate.output).toBe(0);
    const before = await tree(root);
    const build = vellym(root, "build", "--json");
    expect(build.status, build.output).toBe(0);
    // The static output exists only after build, and only under docs/dist/.
    expect((await stat(path.join(root, "docs/dist"))).isDirectory()).toBe(true);
    expect((await tree(root)).filter(file => !before.includes(file)).every(file => file.startsWith("docs/dist/"))).toBe(true);
    // The CLI never commits.
    expect(run(root, "git", ["rev-parse", "--verify", "HEAD"]).status).not.toBe(0);
    // Running init again does not overwrite anything.
    const config = await sha256(path.join(root, "docs/vellym.config.yaml"));
    expect(vellym(root, "init", "--structure", "by-phase", "--language", "ja").status).toBe(0);
    expect(await sha256(path.join(root, "docs/vellym.config.yaml"))).toBe(config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const existing = "apiVersion: vellym.tasclub.com/v1alpha1\nkind: Page\nmetadata:\n  name: existing-welcome\n  title: 既存のWelcome\nspec:\n  blocks:\n    - id: body\n      type: rich-text\n      format: commonmark\n      content: |\n        この文字列は上書き禁止: KEEP-EXISTING-WELCOME\n";

const test = base.extend({
  project: async ({ project }, use) => {
    await unlink(project.config);
    await unlink(project.pageFile);
    await mkdir(path.join(project.root, "docs"));
    await writeFile(path.join(project.root, "docs/index.yaml"), existing);
    await use(project);
  }
});

test("browser setup shows the existing entry as skipped and keeps its bytes @CORE-MANUAL-D01", async ({ page, server, project }) => {
  const entry = path.join(project.root, "docs/index.yaml");
  const hash = await sha256(entry);
  await page.goto(server);
  await page.getByTestId("setup-language").selectOption("ja");
  await expect(page.getByTestId("setup-root-docs")).toBeChecked();
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-structure-by-type").check();
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-files-skip")).toContainText("docs/index.yaml");
  await expect(page.getByTestId("setup-files-create")).not.toContainText("docs/index.yaml");
  // Opening the confirmation step changes nothing.
  expect(await tree(path.join(project.root, "docs"))).toEqual(["index.yaml"]);
  expect(await sha256(entry)).toBe(hash);

  await page.getByTestId("setup-create").click();
  await expect(page.getByTestId("setup-wizard")).toHaveCount(0);
  // The kept entry opens; no request for the generated index that was skipped.
  await expect(page.getByRole("treegrid", { name: "文書", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "既存のWelcome" })).toBeVisible();
  expect(await sha256(entry)).toBe(hash);
  expect(await readFile(entry, "utf8")).toContain("KEEP-EXISTING-WELCOME");
  // Everything else was created; nothing is left half made.
  const files = await tree(path.join(project.root, "docs"));
  for (const file of ["vellym.config.yaml", "VELLYM.md", ".gitignore", "概要/_index.yaml", "要求/_index.yaml", "運用/_index.yaml"]) {
    expect(files).toContain(file);
  }
  expect(files.some(file => file.endsWith(".tmp"))).toBe(false);
  const validate = vellym(project.root, "validate");
  expect(validate.status, validate.output).toBe(0);
});
