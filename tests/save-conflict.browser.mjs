// Run after npm run build: node tests/save-conflict.browser.mjs
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "vellym-conflict-"));
await mkdir(path.join(root, "content"));
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
const config = path.join(root, "vellym.config.yaml");
const file = path.join(root, "content", "guide.yaml");
await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins:\n  - "@vellym/tickets"\n');
const yaml = (content) => `apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: guide\n  title: Conflict test\nspec:\n  locale: en\n  blocks:\n    - id: body\n      type: rich-text\n      content: ${content}\n`;
await writeFile(file, yaml("original"));
const port = 4197;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${base}/en/pages/guide/`, { waitUntil: "networkidle" });
  const button = (name) => page.getByRole("button", { name, exact: true }).first();
  const edit = async (text) => {
    await button("Edit").click();
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(text);
    await expect(editor).toContainText(text.trim());
    await expect(page.getByText("Unsaved", { exact: true }).first()).toBeVisible();
    return editor;
  };
  let editor = await edit(" draft one");
  await writeFile(file, yaml("external one"));
  await expect(page.getByText("The YAML file changed externally.")).toBeVisible({ timeout: 15000 });
  await button("Reload").click();
  const dialog = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await button("Save").click();
  await page.getByText("Compare versions", { exact: true }).click();
  const comparison = page.locator("details").filter({ hasText: "Compare versions" });
  await expect(comparison).toContainText("draft one");
  await expect(comparison).toContainText("external one");
  await button("Keep your draft").click();
  await expect(page.getByText("Unsaved", { exact: true }).first()).toBeVisible();
  await expect(editor).toContainText("draft one");
  await button("Save").click();
  await expect(button("Edit")).toBeVisible();
  expect(await readFile(file, "utf8")).toContain("draft one");
  editor = await edit(" draft two");
  await writeFile(file, yaml("external two"));
  await expect(page.getByText("The YAML file changed externally.")).toBeVisible({ timeout: 15000 });
  await button("Save").click();
  await expect(button("Use the YAML version")).toBeVisible();
  await button("Use the YAML version").click();
  await expect(dialog).toBeHidden();
  await expect(button("Edit")).toBeVisible();
  await expect(page.locator("#document-content")).toContainText("external two");
  console.log("Save conflict comparison, both choices and external reload confirmation: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
