// Run after npm run build: node tests/git-changes.browser.mjs
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const exec = promisify(execFile);
const root = await mkdtemp("/tmp/opencode/git-changes-browser-");
const remote = path.join(root, "remote.git");
const git = async (...args) => (await exec("git", args, { cwd: root })).stdout.trim();
await mkdir(path.join(root, "content"));
await writeFile(path.join(root, "vellym.config.yaml"), 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
const source = 'apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: page\n  title: Change test\nspec:\n  locale: en\n  blocks:\n    - id: body\n      type: rich-text\n      content: Before\n';
await writeFile(path.join(root, "content/page.yaml"), source);
await git("init", "-q"); await git("config", "user.name", "Browser Tester"); await git("config", "user.email", "test@example.test"); await git("config", "commit.gpgSign", "false");
await git("add", "content"); await git("commit", "-qm", "Initial document");
const initial = await git("rev-parse", "HEAD");
await git("init", "--bare", "-q", remote); await git("remote", "add", "origin", remote); await git("push", "-u", "origin", "HEAD");
await writeFile(path.join(root, "content/page.yaml"), source.replace("content: Before", `content: After ${"longword".repeat(60)}`));
await writeFile(path.join(root, "content/new.yaml"), source.replace("name: page", "name: new").replace("Change test", "New document"));
const port = 4191, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", path.join(root, "vellym.config.yaml"), "--port", String(port)]);
let output = "", browser;
server.stdout.on("data", (data) => { output += data; }); server.stderr.on("data", (data) => { output += data; });
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (n > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  const changesEntry = () => page.getByRole("button", { name: /^Changes \(/ }).filter({ visible: true }).first();
  await page.goto(`${base}/pages/page/`);
  await changesEntry().click();
  await expect(page.getByRole("heading", { name: "Uncommitted changes", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a message.");
  await page.getByLabel("Commit message (first line is the subject)").fill("Browser commit");
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Select files to commit.");
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  for (const width of [390, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: /Modified · Change test/ }).click();
    await expect(page.locator("table").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width < 768) await expect(page.getByRole("button", { name: "Commit", exact: true })).toBeHidden();
    else await expect(page.getByRole("button", { name: "Commit", exact: true })).toBeVisible();
    await page.screenshot({ path: `/tmp/opencode/git-changes-${width}.png`, fullPage: true });
  }
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  await page.route("**/api/v1/git/commit", (route) => route.fulfill({ json: { apiSchemaVersion: "1.0", data: { ok: false, code: "author" }, diagnostics: [] } }));
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Git author isn't set");
  await page.unroute("**/api/v1/git/commit");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/v1/git/commit", async (route) => { await gate; await route.continue(); });
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Committing…", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("status").filter({ hasText: "Committed (" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Push", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByRole("button", { name: "Push", exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  // Error codes are localizable; raw Git output must remain inside a closed disclosure.
  for (const [code, label] of [["rejected", "The remote has new commits"], ["authentication", "Authentication failed"], ["failed", "The Git operation failed"], ["noUpstream", "This branch has no upstream"]]) {
    await page.route("**/api/v1/git/push", async (route) => route.fulfill({ json: { apiSchemaVersion: "1.0", data: { ok: false, code, details: "private Git error output" }, diagnostics: [] } }));
    await page.getByRole("button", { name: "Push", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(label);
    await expect(page.getByText("private Git error output", { exact: true })).toBeHidden();
    await page.getByText("Details", { exact: true }).click();
    await expect(page.getByText("private Git error output", { exact: true })).toBeVisible();
    await page.getByText("Details", { exact: true }).click();
    await page.unroute("**/api/v1/git/push");
  }
  await page.getByRole("button", { name: "Push", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pushed." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Push", exact: true })).toHaveCount(0);
  await page.locator("summary").filter({ hasText: "Initial document" }).click();
  await page.getByRole("button", { name: "Change test", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("option", { selected: true })).toContainText("Initial document");
  expect(new URL(page.url()).searchParams.get("commit")).toBe(initial);
  await page.reload();
  await expect(page.getByRole("option", { selected: true })).toContainText("Initial document");
  await page.getByRole("button", { name: "Back to document", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type(" unsaved text");
  await changesEntry().click();
  await expect(page.getByText("You have unsaved edits. Only saved content will be committed.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page.locator('[contenteditable="true"]')).toContainText("unsaved text");
  expect(errors).toEqual([]);
  console.log("Changes: validation, real commit/push, history selection/reload, widths 390/1024/1280, axe: passed");
} finally {
  await browser?.close(); server.kill("SIGTERM"); await new Promise((resolve) => server.once("exit", resolve)); await rm(root, { recursive: true, force: true });
}
