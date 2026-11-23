// Run after npm run build: node tests/native-buttons.browser.mjs
// Screens introduced in 0.5.0-beta must not expose browser-default buttons.
import { execFileSync, spawn } from "node:child_process";
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
    - id: body
      type: rich-text
      content: |-
${body.split("\n").map((line) => `        ${line}`).join("\n")}
`;
const diffBody = Array.from({ length: 16 }, (_, index) => `Paragraph ${index + 1}`).join("\n");
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await write("vellym.config.yaml", 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/kanban"\n  - "@vellym/wbs"\n');
await write("content/docs/_index.yaml", `apiVersion: vellym.tasclub.com/v1
kind: Folder
metadata: { title: Documents }
spec: { locale: en }
`);
await write("content/docs/one.yaml", page("one", "One", diffBody));
await write("content/docs/two.yaml", page("two", "Two", diffBody));
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

execFileSync("git", ["init", "-q", root]);
execFileSync("git", ["-C", root, "add", "content"]);
execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "Fixture"]);
await write("content/docs/one.yaml", page("one", "One", diffBody.replace("Paragraph 8", "Edited paragraph eight")));
await write("content/docs/two.yaml", page("two", "Two", diffBody.replace("Paragraph 9", "Edited paragraph nine")));

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
  await tab.getByRole("button", { name: "History", exact: true }).click();
  await expect(tab.getByRole("heading", { name: /One.*History/ })).toBeVisible();
  await expect(tab.getByRole("region", { name: "Diff", exact: true }).locator("table")).toBeVisible();
  await expectNoNativeButtons(tab, "document history");
  await tab.getByRole("option").filter({ hasText: "Fixture" }).click();
  await expect(tab.getByRole("button", { name: "Show this version", exact: true })).toBeVisible();
  await expectNoNativeButtons(tab, "selected commit and diff controls");
  await tab.getByRole("button", { name: "Back to document", exact: true }).click();
  await tab.getByRole("button", { name: "Edit", exact: true }).click();
  await expectNoNativeButtons(tab, "document editor");
  await tab.getByRole("button", { name: "Page settings", exact: true }).click();
  await expectNoNativeButtons(tab, "page settings");
  await tab.getByRole("button", { name: "Add language", exact: true }).click();
  await expect(tab.getByRole("dialog", { name: "Add a language to this page" })).toBeVisible();
  await expectNoNativeButtons(tab, "page language dialog");
  await tab.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await tab.locator('[contenteditable="true"]').first().click();
  await tab.keyboard.type(" draft");
  await expect(tab.getByText("Unsaved", { exact: true }).first()).toBeVisible();
  await tab.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await expect(tab.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
  await expectNoNativeButtons(tab, "unsaved changes");
  await tab.getByRole("dialog").getByRole("button", { name: "Discard changes" }).click();
  await tab.getByRole("treegrid").getByText("Documents", { exact: true }).click();
  await expect(tab.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await expectNoNativeButtons(tab, "folder display");
  await tab.getByRole("button", { name: "Actions for Documents" }).click();
  await tab.getByRole("menuitem", { name: "Edit display info" }).click();
  await expect(tab.getByRole("tablist", { name: "Folder language to edit" })).toBeVisible();
  await expectNoNativeButtons(tab, "folder editor");
  await tab.getByRole("button", { name: "Add language", exact: true }).click();
  await expect(tab.getByRole("dialog", { name: "Add a language to this folder" })).toBeVisible();
  await expectNoNativeButtons(tab, "folder language dialog");
  await tab.getByRole("dialog", { name: "Add a language to this folder" }).getByRole("button", { name: "Cancel" }).click();
  await tab.getByRole("dialog", { name: "Edit folder info" }).getByRole("button", { name: "Cancel" }).click();


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

  await tab.goto(`${base}/en/pages/one/`, { waitUntil: "networkidle" });
  await tab.getByRole("button", { name: /^Changes \(/ }).first().click();
  await expect(tab.getByRole("heading", { name: "Uncommitted changes", exact: true })).toBeVisible();
  await expect(tab.getByRole("checkbox")).toHaveCount(2);
  await expect(tab.getByRole("button", { name: /unchanged lines/ }).first()).toBeVisible();
  await expectNoNativeButtons(tab, "git changes");
  const rowStyle = await tab.locator('section[aria-labelledby="uncommitted-heading"] ul button[aria-pressed="true"]').evaluate((button) => {
    const style = getComputedStyle(button);
    return { background: style.backgroundColor, border: style.borderTopWidth };
  });
  const selectedTreeBackground = await tab.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--selected-bg)";
    document.body.append(probe);
    const background = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return background;
  });
  expect(rowStyle.background).toBe(selectedTreeBackground);
  expect(rowStyle.border).toBe("0px");

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
  console.log("Native buttons: document, tree, settings, search, ticket list, kanban, WBS, Git changes, and setup: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  setupServer?.kill();
  await rm(root, { recursive: true, force: true });
}
