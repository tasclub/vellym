// Run after npm run build: node tests/native-buttons.browser.mjs
// Screens introduced in 0.5.0-beta must not expose browser-default buttons.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "native-buttons-"));
const write = async (file, text) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
};
const page = (name, title, body) => `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata: { name: ${name}, title: ${title} }
spec:
  locale: en
  blocks:
    - { id: body, type: rich-text, content: "${body}" }
`;
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await write("vellym.config.yaml", 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/kanban"\n  - "@vellym/wbs"\n');
await write("content/docs/one.yaml", page("one", "One", "First page"));
await write("content/docs/two.yaml", page("two", "Two", "Second page"));
await write("content/tracker.yaml", `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: tracker, title: Work }
spec:
  statuses:
    - { id: open, label: Open, category: open }
    - { id: done, label: Done, category: closed }
  fields:
    - { id: priority, label: Priority, type: select, options: [{ value: high, label: High }] }
`);
await write("content/+tickets/ticket-one.yaml", `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata: { name: ticket-one, title: First ticket }
spec:
  status: open
  fields: { priority: high }
`);

const port = 4198;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", path.join(root, "vellym.config.yaml"), "--port", String(port)]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });

async function waitForServer(url, outputOf, acceptsError = false) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${url}/api/v1/repository`);
      if (response.ok || acceptsError) return;
    } catch {}
    if (attempt > 100) throw new Error(outputOf());
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function expectNoNativeButtons(page, name) {
  const native = await page.locator("button").evaluateAll((buttons) =>
    buttons.flatMap((button) => {
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return button.getAttribute("aria-label") !== "Dismiss" && rect.width > 1 && rect.height > 1 &&
        (style.borderStyle === "outset" || style.backgroundColor === "rgb(239, 239, 239)")
        ? [`${button.getAttribute("aria-label") || button.textContent?.trim() || "(unlabelled)"} (${button.className})`]
        : [];
    })
  );
  expect(native, `${name}: native buttons: ${native.join(", ")}`).toEqual([]);
}

let browser;
let setupServer;
try {
  await waitForServer(base, () => output);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const tab = await context.newPage();

  await tab.goto(`${base}/en/pages/one/`, { waitUntil: "networkidle" });
  await expect(tab.getByRole("heading", { level: 1, name: "One" })).toBeVisible();
  await expectNoNativeButtons(tab, "document display");

  await tab.getByRole("button", { name: "Expand all", exact: true }).click();
  await tab.getByRole("button", { name: "Create" }).click();
  await expect(tab.getByRole("menu")).toBeVisible();
  await expectNoNativeButtons(tab, "document tree");

  await tab.goto(`${base}/en/pages/tracker/`, { waitUntil: "networkidle" });
  await tab.getByRole("button", { name: "Tracker settings", exact: true }).click();
  await expectNoNativeButtons(tab, "settings");

  await tab.goto(`${base}/en/pages/one/`, { waitUntil: "networkidle" });
  await tab.getByRole("button", { name: "Open full-text search" }).click();
  await expect(tab.getByRole("dialog")).toBeVisible();
  await expectNoNativeButtons(tab, "search dialog");
  await tab.keyboard.press("Escape");

  await tab.goto(`${base}/en/pages/tracker/`, { waitUntil: "networkidle" });
  await tab.getByRole("button", { name: "Ticket list", exact: true }).click();
  await tab.getByRole("button", { name: /Filters/ }).click();
  await expectNoNativeButtons(tab, "ticket list");

  await tab.getByRole("button", { name: "Kanban", exact: true }).click();
  await expectNoNativeButtons(tab, "kanban");

  await tab.getByRole("button", { name: "WBS", exact: true }).click();
  const rowActions = tab.getByRole("button", { name: /: Row actions$/ }).first();
  await rowActions.focus();
  await tab.keyboard.press("Enter");
  await expect(tab.getByRole("group", { name: "Row actions" })).toBeVisible();
  await expectNoNativeButtons(tab, "WBS");

  const setupRoot = await mkdtemp(path.join(tmpdir(), "native-buttons-setup-"));
  await symlink(path.resolve("node_modules"), path.join(setupRoot, "node_modules"), "dir");
  const setupPort = 4199;
  setupServer = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", path.join(setupRoot, "vellym.config.yaml"), "--port", String(setupPort)]);
  let setupOutput = "";
  setupServer.stdout.on("data", (data) => { setupOutput += data; });
  setupServer.stderr.on("data", (data) => { setupOutput += data; });
  const setupUrl = `http://127.0.0.1:${setupPort}`;
  await waitForServer(setupUrl, () => setupOutput, true);
  const setup = await context.newPage();
  await setup.goto(setupUrl, { waitUntil: "networkidle" });
  await expect(setup.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoNativeButtons(setup, "setup without config");
  await rm(setupRoot, { recursive: true, force: true });
  console.log("Native buttons: document, tree, settings, search, ticket list, kanban, WBS, and setup: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  setupServer?.kill();
  await rm(root, { recursive: true, force: true });
}
