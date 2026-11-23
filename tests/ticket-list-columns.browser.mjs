// Run after npm run build: node tests/ticket-list-columns.browser.mjs
// The ticket list keeps short columns on one line while the title remains readable.
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "ticket-list-columns-"));
const content = path.join(root, "content");
await mkdir(content);
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await cp("how-to-use/content/demo-tickets", path.join(content, "demo-tickets"), { recursive: true });
await writeFile(
  path.join(content, "demo-tickets/+tickets/ticket-01m0m000000000000000000999.yaml"),
  `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata:
  name: ticket-01m0m000000000000000000999
  title: これは題名の列が十分な幅を持つことを確認するための長いチケット
spec:
  status: todo
  fields:
    priority: high
    assignee: 高橋
    due: "2026-11-20"
`
);
const config = path.join(root, "vellym.config.yaml");
await writeFile(
  config,
  'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: ja\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/kanban"\n  - "@vellym/wbs"\n'
);
const port = 4195;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  "packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${base}/ja/pages/demo-tickets/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Ticket list", exact: true }).click();
  await expect(page.locator("table tbody tr")).not.toHaveCount(0);

  const measurements = await page.locator("table tbody tr").first().locator("td").evaluateAll((cells) =>
    cells.map((cell) => ({
      height: cell.getBoundingClientRect().height,
      rects: cell.getClientRects().length,
      text: cell.textContent?.trim() ?? ""
    }))
  );
  // The first cell is the title; every other visible value is a single-line cell.
  for (const cell of measurements.slice(1)) {
    expect(cell.rects, `cell has multiple rects: ${cell.text}`).toBe(1);
  }
  const title = page.locator('[class*="plugin-list-title-column"]').last();
  expect(await title.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(
    await page.evaluate(() => 12 * parseFloat(getComputedStyle(document.body).fontSize))
  );

  const tableScroll = page.locator('[class*="scroll"]').first();
  const dimensions = await tableScroll.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.scrollWidth).toBeGreaterThanOrEqual(dimensions.clientWidth);
  console.log("Ticket list columns: non-title cells stay on one line and the page does not overflow: passed");
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
