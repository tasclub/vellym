// Run after npm run build: node tests/wide-table.browser.mjs
// Wide reading tables must keep usable columns and scroll without squeezing cells.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "wide-table-"));
const content = path.join(root, "content");
await mkdir(content);
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");

const headers = Array.from({ length: 12 }, (_, index) => `見出し${String(index + 1).padStart(2, "0")}項目名称`);
const values = Array.from({ length: 12 }, (_, index) => `内容${String(index + 1).padStart(2, "0")}説明文字列`);
const longText = Array.from({ length: 80 }, () => "This is a long sentence that should wrap inside a bounded table cell").join(" ");
const table = (rows) => rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
const pageContent = [
  table([headers, headers.map(() => "---"), values, [longText, ...values.slice(1)]]),
  "",
  table([
    ["Name", "Status", "Owner"],
    ["---", "---", "---"],
    ["Short page", "Ready", "Ari"]
  ])
].join("\n");
await writeFile(
  path.join(content, "wide-table.yaml"),
  `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: wide-table
  title: Wide table
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: |-
${pageContent.split("\n").map((line) => `        ${line}`).join("\n")}
`
);

const config = path.join(root, "vellym.config.yaml");
await writeFile(
  config,
  'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins: []\n'
);
const port = 4196;
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/en/pages/wide-table/`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "Wide table" })).toBeVisible();

  const scrollAreas = page.locator('[class*="table-scroll"]');
  await expect(scrollAreas).toHaveCount(2);
  const wide = scrollAreas.nth(0);
  const wideDimensions = await wide.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(wideDimensions.scrollWidth).toBeGreaterThan(wideDimensions.clientWidth);

  const headings = await wide.locator("thead th").evaluateAll((cells) =>
    cells.map((cell) => ({
      height: cell.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(cell).lineHeight)
    }))
  );
  expect(headings).toHaveLength(12);
  for (const [index, heading] of headings.entries()) {
    expect(
      heading.height,
      `heading ${index + 1} is taller than one line: ${JSON.stringify(heading)}`
    ).toBeLessThanOrEqual(heading.lineHeight * 1.6);
  }

  const longCell = wide.locator("tbody tr").nth(1).locator("td").first();
  const longCellMetrics = await longCell.evaluate((cell) => ({
    width: cell.getBoundingClientRect().width,
    maxWidth: Number.parseFloat(getComputedStyle(cell).maxWidth),
    fontSize: Number.parseFloat(getComputedStyle(cell).fontSize),
    height: cell.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(cell).lineHeight)
  }));
  expect(longCellMetrics.width).toBeLessThanOrEqual(32 * longCellMetrics.fontSize + 1);
  expect(longCellMetrics.height).toBeGreaterThan(longCellMetrics.lineHeight * 1.6);
  expect(longCellMetrics.maxWidth).toBeLessThanOrEqual(32 * longCellMetrics.fontSize);

  const short = scrollAreas.nth(1);
  const shortDimensions = await short.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    tableWidth: node.querySelector("table").getBoundingClientRect().width
  }));
  expect(shortDimensions.scrollWidth).toBeLessThanOrEqual(shortDimensions.clientWidth);
  expect(shortDimensions.tableWidth).toBeCloseTo(shortDimensions.clientWidth, 0);

  console.log("Wide reading table: horizontal scroll, single-line headings, bounded wrapping, and short-table width: passed");
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
