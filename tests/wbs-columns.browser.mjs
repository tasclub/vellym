// Run after npm run build: node tests/wbs-panes.browser.mjs
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { parse } from "yaml";

const root = await mkdtemp(path.join(tmpdir(), "wbs-panes-"));
const content = path.join(root, "content");
const config = path.join(root, "vellym.config.yaml");
const port = 4199;
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
  await page.getByText("WBS settings", { exact: true }).click();
  await page.getByRole("checkbox", { name: "優先度" }).click();
  await expect(page.getByRole("columnheader", { name: "優先度" })).toBeVisible();
  const yaml = await readFile(path.join(content, "demo-tickets/demo-tickets.yaml"), "utf8");
  if (!parse(yaml).spec.wbs.columns.includes("priority")) throw new Error("missing selected column");
  const scroller = page.locator(".wbs-scroll");
  const cell = page.locator(".wbs-row[data-ticket-name] .wbs-left").first();
  const before = await cell.evaluate((el) => el.getBoundingClientRect().left);
  await scroller.evaluate((el) => { el.scrollLeft = 400; });
  const after = await cell.evaluate((el) => el.getBoundingClientRect().left);
  if (Math.abs(before - after) > 1) throw new Error(`title moved: ${before} ${after}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "WBS", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "優先度" })).toBeVisible();
  console.log("WBS columns persist and title stays fixed: passed");
} finally {
  await browser?.close();
  server?.kill();
  await rm(root, { recursive: true, force: true });
}
