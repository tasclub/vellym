// Run after npm run build: node tests/create-draft.browser.mjs
// Create commands must not write YAML until the first save (ticket-01m7k6gftj62n02gkr2qwe6xxm).
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "create-draft-"));
const content = path.join(root, "content");
await mkdir(content);
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await cp("how-to-use/content/demo-tickets", path.join(content, "demo-tickets"), { recursive: true });
const config = path.join(root, "vellym.config.yaml");
await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: ja\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/kanban"\n  - "@vellym/wbs"\n');
const port = 4194;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });

const yamlFiles = async () => (await readdir(content, { recursive: true })).filter((name) => name.endsWith(".yaml")).sort();
const listUrl = `${base}/ja/pages/demo-tickets/`;

/** Each entry starts a create command from its own place and returns once the draft is open. */
const entries = {
  "ticket list": async (page) => {
    await page.getByRole("button", { name: "Ticket list", exact: true }).click();
    await page.getByRole("button", { name: "New ticket", exact: true }).click();
  },
  "document tree": async (page) => {
    await page.getByRole("button", { name: "Create in デモ：チケット管理" }).click();
    await page.getByRole("menuitem", { name: "Ticket tracker" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("draft-tracker");
    await dialog.getByRole("button", { name: "Ticket tracker" }).click();
  },
  kanban: async (page) => {
    await page.getByRole("button", { name: "Kanban", exact: true }).click();
    await page.getByRole("button", { name: "New ticket", exact: true }).click();
  },
  "WBS child task": async (page) => {
    await page.getByRole("button", { name: "WBS", exact: true }).click();
    const actions = page.getByRole("button", { name: /: Row actions$/ }).first();
    await actions.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("group", { name: "Row actions" }).getByRole("button", { name: "Add child task" }).click();
  }
};
/** Ways of leaving a draft without saving. */
const leaves = {
  "open another document": (page) => page.getByText("デモの見どころ", { exact: true }).first().click(),
  cancel: (page) => page.getByRole("button", { name: "Cancel", exact: true }).first().click(),
  "browser back": (page) => page.goBack(),
  reload: (page) => page.reload()
};

let browser;
const pristinePrompts = [];
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const before = await yamlFiles();

  for (const [entryName, start] of Object.entries(entries)) {
    for (const [leaveName, leave] of Object.entries(leaves)) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.on("dialog", (dialog) => {
        if (dialog.type() === "beforeunload") pristinePrompts.push(`${entryName} / ${leaveName}`);
        void dialog.accept();
      });
      await page.goto(listUrl, { waitUntil: "networkidle" });
      await start(page);
      await expect(page.getByRole("button", { name: "Save", exact: true }).first()).toBeVisible();
      await leave(page);
      await page.waitForLoadState("networkidle");
      expect(await yamlFiles(), `${entryName} / ${leaveName} left a file behind`).toEqual(before);
      await context.close();
    }
  }

  // Saving writes exactly one file, and that file validates without warnings.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(listUrl, { waitUntil: "networkidle" });
    await entries["ticket list"](page);
    await page.waitForURL(/\/pages\/ticket-[0-9a-z]+\/$/);
    const name = page.url().match(/ticket-[0-9a-z]+/)?.[0];
    if (!name) throw new Error(`draft URL has no Ticket name: ${page.url()}`);
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    const after = await yamlFiles();
    expect(after.filter((file) => !before.includes(file))).toEqual([`demo-tickets/+tickets/${name}.yaml`]);
    const validate = spawnSync(process.execPath, ["packages/vellym/dist/cli.mjs", "validate", "--strict", "--json", "--config", config], { encoding: "utf8" });
    const diagnostics = JSON.parse(validate.stdout).diagnostics.filter((item) => item.file?.includes(name) || item.path?.includes(name));
    expect(diagnostics, validate.stdout).toEqual([]);
    await context.close();
  }

  // Typing in a draft and then leaving asks first.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(listUrl, { waitUntil: "networkidle" });
    await entries["ticket list"](page);
    await page.waitForURL(/\/pages\/ticket-[0-9a-z]+\/$/);
    const draftUrl = page.url();
    await page.getByRole("textbox").first().fill("Typed title");
    let asked = false;
    page.once("dialog", (dialog) => { asked = true; void dialog.dismiss(); });
    await page.reload().catch(() => undefined);
    expect(asked, "reloading a typed draft did not ask first").toBe(true);
    expect(page.url()).toBe(draftUrl);
    await context.close();
  }

  // A file created elsewhere under the draft's name is reported, not overwritten.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(listUrl, { waitUntil: "networkidle" });
    await entries["ticket list"](page);
    await page.waitForURL(/\/pages\/ticket-[0-9a-z]+\/$/);
    const name = page.url().match(/ticket-[0-9a-z]+/)?.[0];
    const file = path.join(content, "demo-tickets/+tickets", `${name}.yaml`);
    await writeFile(file, "external: true\n");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: "Conflicted with an external change" })).toBeVisible();
    expect(await readFile(file, "utf8")).toBe("external: true\n");
    await context.close();
  }
  const note = pristinePrompts.length ? `; pristine drafts asked before leaving in ${pristinePrompts.length} case(s): ${pristinePrompts.join(", ")}` : "";
  console.log(`Create drafts: 4 commands x 4 ways of leaving leave no file, save writes once and validates, typed drafts ask, conflicts are reported: passed${note}`);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
