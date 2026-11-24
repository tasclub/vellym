// Run after npm run build.
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { parse } from "yaml";

const root = await mkdtemp(path.join(tmpdir(), "wbs-indent-"));
const content = path.join(root, "content");
await mkdir(content);
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await cp("how-to-use/content/demo-tickets", path.join(content, "demo-tickets"), { recursive: true });
const config = path.join(root, "vellym.config.yaml");
await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: ja\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/wbs"\n');
const port = 4196;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });
let browser;

async function readTickets() {
  const directory = path.join(content, "demo-tickets/+tickets");
  const files = await readdir(directory);
  return Promise.all(files.filter((file) => file.endsWith(".yaml")).map(async (file) =>
    parse(await readFile(path.join(directory, file), "utf8"))));
}

async function ticketByTitle(title) {
  const ticket = (await readTickets()).find((item) => item.metadata.title === title);
  expect(ticket, `ticket ${title} should exist in YAML`).toBeTruthy();
  return ticket;
}

try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/ja/pages/demo-tickets/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "WBS", exact: true }).click();
  const url = page.url();
  const titles = ["A Indent parent", "B Indent child", "C Indent next sibling"];
  await page.getByRole("button", { name: "＋ Add", exact: true }).click();
  const titleInput = page.getByRole("textbox", { name: "New task title", exact: true });
  const form = page.locator(".wbs-quick-add");
  for (const title of titles) {
    await titleInput.fill(title);
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await expect(titleInput).toHaveValue("");
    await expect(page.locator("[data-ticket-name]").filter({ hasText: title })).toHaveCount(1);
    expect(page.url()).toBe(url);
  }
  await form.getByRole("button", { name: "Cancel", exact: true }).click();

  const parent = await ticketByTitle(titles[0]);
  const child = await ticketByTitle(titles[1]);
  const childRow = page.locator(`[data-ticket-name="${child.metadata.name}"]`);
  const rowActions = childRow.getByRole("button", { name: `${titles[1]}: Row actions` });
  await rowActions.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("group", { name: "Row actions" }).getByRole("button", { name: "Indent", exact: true }).click();
  await expect(childRow).toHaveAttribute("aria-level", "2");
  expect((await ticketByTitle(titles[1])).spec.fields.parent).toBe(parent.metadata.name);

  await rowActions.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("group", { name: "Row actions" }).getByRole("button", { name: "Outdent", exact: true }).click();
  await expect(childRow).toHaveAttribute("aria-level", "1");
  const indentedChild = await ticketByTitle(titles[1]);
  expect(indentedChild.spec.fields.parent == null).toBe(true);

  const rows = await page.locator("[data-ticket-name]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-ticket-name")));
  const parentIndex = rows.indexOf(parent.metadata.name);
  expect(rows[parentIndex + 1]).toBe(child.metadata.name);
  expect(rows[parentIndex + 2]).toBe((await ticketByTitle(titles[2])).metadata.name);
  console.log("WBS indent/outdent: parent reference and adjacent sibling order round-trip through YAML: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
