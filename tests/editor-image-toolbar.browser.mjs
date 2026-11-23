// Run after npm run build: node tests/editor-image-toolbar.browser.mjs
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "image-toolbar-"));
await mkdir(path.join(root, "content"));
await writeFile(path.join(root, "vellym.config.yaml"), 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
await writeFile(path.join(root, "content/page.yaml"), 'apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: page\n  title: Image test\nspec:\n  locale: en\n  blocks:\n    - id: first\n      type: rich-text\n      content: First block\n    - id: second\n      type: rich-text\n      content: Second block\n');
const base = "http://127.0.0.1:4196";
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", path.join(root, "vellym.config.yaml"), "--port", "4196"]);
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
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/en/pages/page`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editors = page.locator('[contenteditable="true"]');
  await expect(editors).toHaveCount(2);
  await expect(page.locator(".block-editor").getByRole("button", { name: "Insert image" })).toHaveCount(0);
  const button = page.getByRole("toolbar").getByRole("button", { name: "Insert image" });
  await expect(button).toBeVisible();
  await editors.nth(1).click();
  await page.keyboard.press("End");
  const chooser = page.waitForEvent("filechooser");
  await button.click();
  await (await chooser).setFiles({ name: "test.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") });
  await expect(editors.nth(1).locator('img[alt="test.png"]')).toHaveCount(1);
  await expect(editors.nth(0).locator('img[alt="test.png"]')).toHaveCount(0);
  await page.setViewportSize({ width: 767, height: 900 });
  await expect(button).toBeHidden();
  console.log("Image toolbar targets the last focused block and hides on mobile: passed");
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
