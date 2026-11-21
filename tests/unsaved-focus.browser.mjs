// Run after npm run build: node tests/unsaved-focus.browser.mjs
// Keep the edit target and ProseMirror selection after dismissing unsaved changes.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "vellym-unsaved-focus-"));
const content = path.join(root, "content");
await mkdir(path.join(content, "+tickets"), { recursive: true });
await mkdir(path.join(content, "manual-destination"), { recursive: true });
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
const config = path.join(root, "vellym.config.yaml");
await writeFile(
  config,
  'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins:\n  - "@vellym/tickets"\n'
);
await writeFile(
  path.join(content, "tracker.yaml"),
  `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata:
  name: tracker
  title: Work
spec:
  statuses:
    - { id: open, label: Open, category: open }
    - { id: done, label: Done, category: closed }
  fields:
    - { id: owner, label: Owner, type: text, listColumn: true }
  `
);
await writeFile(
  path.join(content, "guide.yaml"),
  `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: guide
  title: Focus test
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: alpha omega
`
);
await writeFile(
  path.join(content, "+tickets/issue.yaml"),
  `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata:
  name: issue
  title: Focus test
spec:
  status: open
  fields:
    owner: Alice
  blocks:
    - id: body
      type: rich-text
      content: alpha omega
`
);
await writeFile(
  path.join(content, "other.yaml"),
  `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: other
  title: Other page
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: Other content
`
);

const port = 4198;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  "packages/vellym/dist/cli.mjs",
  "dev",
  "--config",
  config,
  "--port",
  String(port)
]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${base}/api/v1/repository`)).ok) break;
    } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/en/pages/guide/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: "Focus test" }).waitFor();
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.type(" draft");
  await expect(editor).toContainText("alpha draft omega");
  await expect(page.getByText("Unsaved", { exact: true }).first()).toBeVisible();
  const cancel = page.getByRole("button", { name: "Cancel", exact: true }).first();
  await cancel.click();
  const dialog = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type("X");
  await expect(editor).toContainText("alpha draftX omega");

  const tree = page.getByRole("treegrid");
  await tree.getByText("Other page", { exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor).toBeFocused();
  await expect(editor).toContainText("alpha draftX omega");

  await tree.getByText("Other page", { exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Other page" })).toBeVisible();

  await page.goto(`${base}/en/pages/guide/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" draft");
  await expect(editor).toContainText("alpha omega draft");
  await expect(page.getByText("Unsaved", { exact: true }).first()).toBeVisible();

  await tree.getByText("manual-destination", { exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type("Y");
  await expect(editor).toContainText("alpha omega draftY");

  const pluginPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pluginPage.on("pageerror", (error) => errors.push(error.message));
  await pluginPage.goto(`${base}/en/pages/issue/`, { waitUntil: "networkidle" });
  await pluginPage.getByRole("heading", { level: 1, name: "Focus test" }).waitFor();
  await pluginPage.getByRole("button", { name: "Edit", exact: true }).click();
  const pluginCancel = pluginPage.getByRole("button", { name: "Cancel", exact: true }).first();
  const pluginDialog = pluginPage.getByRole("dialog", { name: "Unsaved changes" });
  const status = pluginPage.locator("#plugin-field-status");
  await status.focus();
  await status.selectOption("done");
  await pluginCancel.click();
  await expect(pluginDialog).toBeVisible();
  await pluginDialog.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(status).toBeFocused();
  await expect(status).toHaveValue("done");

  // Escape and a click outside the dialog use the same stay-and-restore path.
  const owner = pluginPage.locator("#plugin-field-owner");
  await owner.fill("Alice Draft");
  await pluginCancel.click();
  await expect(pluginDialog).toBeVisible();
  await pluginPage.keyboard.press("Escape");
  await expect(pluginDialog).toBeHidden();
  await expect(owner).toBeFocused();
  await expect(owner).toHaveValue("Alice Draft");

  await owner.fill("Alice Outside");
  await pluginCancel.click();
  await expect(pluginDialog).toBeVisible();
  await pluginPage.mouse.click(10, 10);
  await expect(pluginDialog).toBeHidden();
  await expect(owner).toBeFocused();
  await expect(owner).toHaveValue("Alice Outside");

  expect(errors).toEqual([]);
  console.log("Unsaved changes: body caret, plugin field, Keep editing, Escape, and outside dismissal restore focus: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
