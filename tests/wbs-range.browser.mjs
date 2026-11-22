// Run after npm run build: node tests/wbs-range.browser.mjs
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "wbs-range-"));
const content = path.join(root, "content");
const config = path.join(root, "vellym.config.yaml");
const port = 4195;
const base = `http://127.0.0.1:${port}`;
let server;
let browser;
let output = "";
try {
  await mkdir(content);
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  await cp("how-to-use/content/demo-tickets", path.join(content, "demo-tickets"), { recursive: true });
  await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: ja\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/wbs"\n');
  server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)]);
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/ja/pages/demo-tickets/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "WBS", exact: true }).click();
  await page.getByRole("combobox", { name: "Range", exact: true }).selectOption("custom");
  const start = page.getByRole("textbox", { name: "Range start", exact: true });
  await start.fill("2026-12-17");
  await start.press("Tab");
  await expect(start).toHaveValue("2026-12-17");
  await expect(page.getByTitle("2026-12-17", { exact: true })).toBeVisible();
  console.log("WBS custom range preserves a typed start date: passed");
} finally {
  await browser?.close();
  server?.kill();
  await rm(root, { recursive: true, force: true });
}
