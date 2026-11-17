// Run after npm run build: node tests/image-upload.browser.mjs
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const root = await mkdtemp("/tmp/opencode/image-upload-");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
await mkdir(path.join(root, "content"));
await writeFile(path.join(root, "vellym.config.yaml"), 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\nassets:\n  maxBytes: 1000\n');
await writeFile(path.join(root, "content/page.yaml"), 'apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: page\n  title: Image test\nspec:\n  locale: en\n  blocks:\n    - id: body\n      type: rich-text\n      content: Before After\n');
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", path.join(root, "vellym.config.yaml"), "--port", "4189"]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch("http://127.0.0.1:4189/api/v1/repository")).ok) break; } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4189/en/pages/page");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+Home");
  // Hold the first upload while text is inserted: its position must follow edits.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/v1/assets", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  const transfer = async (kind, name, type, bytes) => editor.evaluate((element, data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data.bytes)], data.name, { type: data.type }));
    const event = data.kind === "paste"
      ? new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })
      : new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true,
          clientX: element.getBoundingClientRect().left + 20, clientY: element.getBoundingClientRect().top + 10 });
    element.dispatchEvent(event);
  }, { kind, name, type, bytes: [...bytes] });
  await transfer("paste", "clipboard.png", "image/png", png);
  await expect(page.getByRole("status").filter({ hasText: "Uploading image" })).toBeVisible();
  await page.keyboard.type("prefix ");
  release();
  await expect(editor.locator("img")).toHaveCount(1);
  await expect(editor.locator("img")).toHaveAttribute("alt", "clipboard.png");
  expect(await editor.locator("img").evaluate((img) => img.parentElement.previousSibling?.textContent)).toBe("prefix ");
  await page.getByRole("textbox", { name: "Image alternative text" }).fill("Diagram");
  await transfer("drop", "dropped.png", "image/png", png);
  await expect(editor.locator("img")).toHaveCount(2);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert image" }).click();
  await (await chooser).setFiles({ name: "selected.png", mimeType: "image/png", buffer: png });
  await expect(editor.locator("img")).toHaveCount(3);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  await transfer("paste", "unsafe.svg", "image/svg+xml", Buffer.from("<svg/>"));
  await expect(page.getByRole("alert")).toContainText("Use a PNG");
  await transfer("paste", "large.png", "image/png", Buffer.concat([png, Buffer.alloc(1000)]));
  await expect(page.getByRole("alert")).toContainText("size limit");
  await expect(editor.locator("img")).toHaveCount(3);
  await page.screenshot({ path: "/tmp/opencode/image-upload-edit.png", fullPage: true });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  const image = page.getByRole("img", { name: "Diagram", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  const source = await readFile(path.join(root, "content/page.yaml"), "utf8");
  expect(source).toMatch(/!\[Diagram\]\(asset:\d{4}\/\d{2}\/[0-9a-z]{26}\.png\)/);
  expect(source.match(/asset:/g)).toHaveLength(3);
  await page.reload();
  await expect(page.getByRole("img", { name: "Diagram", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/opencode/image-upload-read.png", fullPage: true });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Image alternative text" })).toHaveCount(3);
  await expect(editor.locator('img[alt="Diagram"]')).toBeVisible();
  await page.getByRole("textbox", { name: "Image alternative text" }).nth(1).fill("Updated diagram");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("img", { name: "Updated diagram", exact: true })).toBeVisible();
  // Unmounting the editor while an upload is outstanding must not insert into a later session.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(editor).toBeVisible();
  await page.unroute("**/api/v1/assets");
  let releaseCancelled;
  const cancelled = new Promise((resolve) => { releaseCancelled = resolve; });
  await page.route("**/api/v1/assets", async (route) => {
    if (route.request().method() === "POST") await cancelled;
    await route.continue().catch(() => {});
  });
  await transfer("paste", "cancelled.png", "image/png", png);
  await expect(page.getByRole("status").filter({ hasText: "Uploading image" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  releaseCancelled();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(editor.locator("img")).toHaveCount(3);
  expect(await readFile(path.join(root, "content/page.yaml"), "utf8")).not.toContain("cancelled.png");
  // Use the same API error in Japanese, not an English server fallback.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.route("**/api/v1/bootstrap*", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.data.project.language = "ja";
    await route.fulfill({ response, json });
  });
  await page.reload();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await expect(page.getByRole("button", { name: "画像を挿入" })).toBeVisible();
  await page.unroute("**/api/v1/assets");
  await transfer("paste", "unsafe.svg", "image/svg+xml", Buffer.from("<svg/>"));
  await expect(page.getByRole("alert")).toContainText("PNG");
  expect(await page.getByRole("alert").innerText()).not.toContain("Use a PNG");
  await page.screenshot({ path: "/tmp/opencode/image-upload-ja.png", fullPage: true });
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  // Even if a host incorrectly mounts an editor in static mode, it exposes no upload operation.
  await page.evaluate(() => {
    window.__VELLYM_STATIC__ = {
      appBase: location.origin + "/", assetBase: location.origin + "/assets/",
      dataBase: location.origin + "/data", buildId: "test", locale: "en", defaultLocale: "en"
    };
  });
  let staticUploads = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/api/v1/assets")) staticUploads++; });
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole("button", { name: "画像を挿入" })).toHaveCount(0);
  await transfer("paste", "static.png", "image/png", png);
  expect(staticUploads).toBe(0);
  console.log("image paste/drop/selection, mapped insertion, alt edit, rejection, save/read/reload: passed");
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
