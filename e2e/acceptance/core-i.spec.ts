import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";
import { test as base, expect, cliPath } from "../fixtures.js";

// CORE-MANUAL-E01〜E04 (Core手動受入シナリオ「E. 作った後に足す」).
const vellym = (cwd: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

base("validate finds docs/vellym.config.yaml from the project root and docs/, and stops on two candidates @CORE-MANUAL-E04", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vellym-core-e04-")));
  try {
    const init = vellym(root, "init", "--language", "ja");
    expect(init.status, init.output).toBe(0);
    // A Page that exists only under docs/ proves which config was used.
    await writeFile(path.join(root, "docs/e04.yaml"),
      "apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata: { name: e04-marker, title: E04 }\nspec:\n  locale: ja\n  blocks:\n    - { id: body, type: rich-text, content: \"設定の探し方\" }\n");

    const fromRoot = vellym(root, "validate");
    expect(fromRoot.status, fromRoot.output).toBe(0);
    expect(fromRoot.output).toContain("2ページ");

    const fromDocs = vellym(path.join(root, "docs"), "validate");
    expect(fromDocs.status, fromDocs.output).toBe(0);
    expect(fromDocs.output).toContain("2ページ");

    await mkdir(path.join(root, "vellym"));
    await copyFile(path.join(root, "docs/vellym.config.yaml"), path.join(root, "vellym/vellym.config.yaml"));
    const ambiguous = vellym(root, "validate");
    expect(ambiguous.status, ambiguous.output).toBe(2);
    expect(ambiguous.output).toContain(path.join(root, "docs/vellym.config.yaml"));
    expect(ambiguous.output).toContain(path.join(root, "vellym/vellym.config.yaml"));
    expect(ambiguous.output).toContain("--config");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// E01〜E03 start from the Japanese CLI init with the tickets plugin, served by `vellym dev`.
const test = base.extend({
  project: async ({ project }, use) => {
    await unlink(project.config);
    await unlink(project.pageFile);
    await rm(project.content, { recursive: true });
    const init = vellym(project.root, "init", "--language", "ja", "--plugins", "tickets");
    expect(init.status, init.output).toBe(0);
    const docs = path.join(project.root, "docs");
    await use({ ...project, config: path.join(docs, "vellym.config.yaml"), content: docs });
  }
});
test.use({ plugins: ["tickets"] });
const folderRow = (page: import("@playwright/test").Page, title: string) =>
  page.getByRole("treegrid", { name: "文書", exact: true }).getByRole("row", { name: new RegExp(title) }).first();
const validateJson = (root: string) => {
  const result = vellym(root, "validate", "--json");
  return { ...result, json: JSON.parse(result.output.slice(result.output.indexOf("{"))) as { diagnostics: Array<{ severity: string; code: string; message: string }> } };
};

test("templates from the screen and the CLI keep names, skip the same path and append the guide once @CORE-MANUAL-E01", async ({ page, server, project }) => {
  const guide = path.join(project.content, "VELLYM.md");
  const original = await readFile(guide, "utf8");
  await page.goto(server);
  await folderRow(page, "要求").click();
  await page.getByTestId("folder-add-template").click();
  await page.getByTestId("template-add-option-functional-requirements").check();
  await page.getByTestId("template-add-name").fill("ログイン");
  await expect(page.getByTestId("template-add-preview")).toContainText("要求/ログイン.yaml");
  await page.getByTestId("template-add-guide").check();
  await page.getByTestId("template-add-create").click();
  await expect(page.getByRole("heading", { level: 1, name: "ログイン" })).toBeVisible();
  const login = parse(await readFile(path.join(project.content, "要求/ログイン.yaml"), "utf8"));
  const body = login.spec.blocks[0].content as string;
  expect(body).toMatch(/^## 目的/m);
  expect(body).toContain("何を実現しますか？");
  expect(body).toContain("| ID | 内容 | 優先度 |");
  expect(body).toContain("例: ");

  const add = vellym(project.root, "add", "template", "decision", "--name", "認証方式を決める", "--guide");
  expect(add.status, add.output).toBe(0);
  const decision = "アーキテクチャ/決定記録/認証方式を決める.yaml";
  expect(await readdir(path.join(project.content, "アーキテクチャ/決定記録"))).toContain("認証方式を決める.yaml");
  const again = vellym(project.root, "add", "template", "decision", "--name", "認証方式を決める", "--guide", "--dry-run", "--json");
  expect(again.status, again.output).toBe(0);
  const againFiles = (JSON.parse(again.output) as { data: { plan: { files: Array<{ relativePath: string; status: string; reason?: { code: string } }> } } }).data.plan.files;
  expect(againFiles.find(file => file.relativePath.endsWith(decision))).toMatchObject({ status: "skip", reason: { code: "EXISTS" } });
  const other = vellym(project.root, "add", "template", "decision", "--name", "ログの保存期間を決める", "--dry-run", "--json");
  expect(other.status, other.output).toBe(0);
  const otherFiles = (JSON.parse(other.output) as { data: { plan: { files: Array<{ relativePath: string; status: string }> } } }).data.plan.files;
  expect(otherFiles.find(file => file.relativePath.endsWith("アーキテクチャ/決定記録/ログの保存期間を決める.yaml"))?.status).toBe("create");
  expect(await readdir(path.join(project.content, "アーキテクチャ/決定記録"))).not.toContain("ログの保存期間を決める.yaml");

  // The guide keeps its earlier text and gets one section per template.
  const appended = await readFile(guide, "utf8");
  expect(appended.startsWith(original.trimEnd())).toBe(true);
  for (const id of ["functional-requirements", "decision"]) {
    expect(appended.split(`vellym:guide:add-template-${id}`).length - 1, id).toBeGreaterThanOrEqual(1);
    expect(appended.split(`<!-- vellym:guide:add-template-${id}`).length - 1, id).toBe(1);
  }
  const validate = validateJson(project.root);
  expect(validate.status, validate.output).toBe(0);
});

test("ticket management in 管理, a bug tracker from the CLI, and a warning for a closed ticket without updated documents @CORE-MANUAL-E02", async ({ page, server, project }) => {
  await page.goto(server);
  await folderRow(page, "管理").click();
  await page.getByTestId("folder-add-resource").click();
  await page.getByTestId("template-add-option-tickets:work").check();
  await page.getByTestId("template-add-create").click();
  await expect(page.getByTestId("plugin-list")).toBeVisible();
  await page.getByTestId("plugin-list").getByRole("button", { name: /作成|新規|追加/ }).first().click();
  await expect(page.getByTestId("document-save")).toBeVisible();
  await page.getByRole("textbox", { name: "ページタイトル", exact: true }).fill("受入の作業");
  await page.getByTestId("document-save").click();
  const tickets = path.join(project.content, "管理/+tickets");
  await expect.poll(async () => (await readdir(tickets).catch(() => [])).length).toBe(1);
  await expect(page.getByRole("heading", { level: 1, name: "受入の作業" })).toBeVisible();

  const bug = vellym(project.root, "add", "template", "tickets:bug", "--folder", "design");
  expect(bug.status, bug.output).toBe(0);
  const design = await readdir(path.join(project.content, "design"));
  expect(design.some(name => name.endsWith(".yaml") && name !== "_index.yaml")).toBe(true);
  const clean = validateJson(project.root);
  expect(clean.status, clean.output).toBe(0);

  // Close the ticket with "直した文書" empty: validate warns but does not fail.
  const [file] = await readdir(tickets);
  const ticketPath = path.join(tickets, file!);
  const ticket = parse(await readFile(ticketPath, "utf8"));
  ticket.spec.status = "done";
  await writeFile(ticketPath, stringify(ticket));
  const warned = validateJson(project.root);
  expect(warned.status, warned.output).toBe(0);
  expect(warned.json.diagnostics.some(item => item.severity === "warning" && /updatedDocuments|直した文書/.test(`${item.code} ${item.message}`)), warned.output).toBe(true);
});

test("a repeated sprint set makes two folders and previews before creating @CORE-MANUAL-E03", async ({ page, server, project }) => {
  await page.goto(server);
  await folderRow(page, "管理").click();
  for (const [name, folder] of [["Sprint 1", "sprint-1"], ["Sprint 2", "sprint-2"]] as const) {
    await page.getByTestId("folder-add-set").click();
    await page.getByTestId("template-add-option-sprint").check();
    await page.getByTestId("template-add-name").fill(name);
    await expect(page.getByTestId("template-add-preview")).toContainText(`管理/${folder}/`);
    expect(await readdir(path.join(project.content, "管理"))).not.toContain(folder);
    await page.getByTestId("template-add-create").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  for (const folder of ["sprint-1", "sprint-2"]) {
    const files = await readdir(path.join(project.content, "管理", folder));
    expect(files.filter(name => name.endsWith(".yaml") && name !== "_index.yaml").length, folder).toBeGreaterThan(0);
  }
  const validate = validateJson(project.root);
  expect(validate.status, validate.output).toBe(0);
});
