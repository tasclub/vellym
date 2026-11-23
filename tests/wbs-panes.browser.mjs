// Run after npm run build: node tests/wbs-panes.browser.mjs
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "wbs-panes-"));
const content = path.join(root, "content");
const config = path.join(root, "vellym.config.yaml");
const port = 4198;
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
  const schedule = page.getByRole("button", { name: "Schedule", exact: true });
  await schedule.click();
  await expect(page.getByRole("combobox", { name: "Range", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Scale", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
  const dimensions = await page.locator(".wbs-scroll").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  if (dimensions.scroll > dimensions.client) throw new Error(JSON.stringify(dimensions));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "WBS", exact: true }).click();
  await expect(schedule).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".wbs-date-header")).toHaveCount(0);
  for (const name of ["Title", "Details", "Schedule"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.isEnabled()) await button.click();
    const geometry = await page.locator(".wbs-row[data-ticket-name]").first().evaluate((row) =>
      [...row.children].map((cell) => ({ top: cell.getBoundingClientRect().top, height: cell.getBoundingClientRect().height })));
    if (geometry.some((cell) => cell.top !== geometry[0].top || cell.height !== geometry[0].height)) throw new Error(JSON.stringify(geometry));
  }
  console.log("WBS panes persist without horizontal overflow: passed");
} finally {
  await browser?.close();
  server?.kill();
  await rm(root, { recursive: true, force: true });
}
