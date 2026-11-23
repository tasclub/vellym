// npm run verify:ui-locale — an English-only project must show no Japanese UI text
// (ticket-01m7nyfvg41wrh27nhzqzvd4kp). Every string the project itself contains is ASCII,
// so any kana or kanji on screen is a UI string that skipped the dictionary.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "vellym-ui-locale-"));
const content = path.join(root, "content");
const write = async (file, text) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
};
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
};
const page = (name, title, body) => `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: ${name}
  title: ${title}
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: |
${body.split("\n").map((line) => `        ${line}`).join("\n")}
`;
const ticket = (name, title, status, fields) => `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata:
  name: ${name}
  title: ${title}
spec:
  status: ${status}
  fields:
${Object.entries(fields).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`).join("\n")}
  blocks:
    - id: body
      type: rich-text
      content: "Description of ${title}."
`;

await mkdir(content);
// Plugins resolve from the config folder, so give the temporary project this repository's modules.
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await write("vellym.config.yaml", 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/kanban"\n  - "@vellym/wbs"\n');
await write("content/index.yaml", page("index", "Home", "## Welcome\n\nStart with the [[guide|guide]].\n\n### Next steps\n\nRead the guide."));
await write("content/guide.yaml", page("guide", "Guide", "## Overview\n\nThe first version of the guide.\n\n### Details\n\nMore text."));
await write("content/tracker.yaml", `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: tracker, title: Work }
spec:
  statuses:
    - { id: open, label: Open, category: open }
    - { id: doing, label: Doing, category: open }
    - { id: done, label: Done, category: closed }
  fields:
    - { id: priority, label: Priority, type: select, listColumn: true, options: [{ value: high, label: High }, { value: low, label: Low }] }
    - { id: parent, label: Parent, type: reference }
    - { id: start, label: Start, type: date }
    - { id: due, label: Due, type: date, listColumn: true }
  hierarchy: { parentField: parent }
  wbs: { startField: start, endField: due }
`);
await write("content/+tickets/ticket-parent.yaml", ticket("ticket-parent", "Plan the release", "doing", { priority: "high", start: "2026-11-01", due: "2026-11-30" }));
await write("content/+tickets/ticket-child-a.yaml", ticket("ticket-child-a", "Write the notes", "open", { priority: "low", parent: "ticket-parent", start: "2026-11-02", due: "2026-11-10" }));
await write("content/+tickets/ticket-child-b.yaml", ticket("ticket-child-b", "Check the links", "done", { priority: "high", parent: "ticket-parent", start: "2026-11-11", due: "2026-11-20" }));
await write("content/+tickets/ticket-alone.yaml", ticket("ticket-alone", "Tidy the glossary", "open", { priority: "low", start: "2026-11-05", due: "2026-11-25" }));
git("init", "-q");
git("config", "user.name", "UI locale check");
git("config", "user.email", "ui-locale@example.invalid");
git("config", "commit.gpgSign", "false");
git("add", "vellym.config.yaml", "content");
git("commit", "-qm", "Add the project");
await write("content/guide.yaml", page("guide", "Guide", "## Overview\n\nThe second version of the guide.\n\n### Details\n\nMore text."));
git("add", "content");
git("commit", "-qm", "Update the guide");
await write("content/guide.yaml", page("guide", "Guide", "## Overview\n\nAn uncommitted version of the guide.\n\n### Details\n\nMore text."));

const port = 4191;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", path.join(root, "vellym.config.yaml"), "--host", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });

const findings = [];
const screens = [];
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${origin}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 100) throw new Error(`dev server did not become ready\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 900 } });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error.message));

  /** Records every Japanese line of text and attribute value on the current screen. */
  const scan = async (screen) => {
    await tab.waitForLoadState("networkidle");
    const found = await tab.evaluate(() => {
      const ja = /[\u3040-\u30ff\u3400-\u9fff]/;
      const describe = (element) => element.tagName.toLowerCase()
        + (element.id ? `#${element.id}` : "")
        + (element.getAttribute("role") ? `[role=${element.getAttribute("role")}]` : "")
        + (typeof element.className === "string" && element.className ? `.${element.className.split(/\s+/)[0]}` : "");
      // Text marked with a non-English lang (such as a language's own name, 日本語) is
      // deliberate; unmarked Japanese is a UI string that skipped the dictionary.
      const marked = (element) => {
        const lang = element.closest("[lang]")?.getAttribute("lang") ?? "";
        return lang !== "" && !/^en\b/i.test(lang);
      };
      const result = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node.parentElement;
        const value = node.textContent?.trim() ?? "";
        if (!element || !ja.test(value) || element.closest("script,style") || marked(element)) continue;
        const visible = element.closest("option") ? element.closest("select")?.checkVisibility() : element.checkVisibility();
        if (visible) result.push({ kind: "text", element: describe(element), value });
      }
      for (const element of document.querySelectorAll("[aria-label],[title],[placeholder],[alt]")) {
        if (marked(element)) continue;
        for (const name of ["aria-label", "title", "placeholder", "alt"]) {
          const value = element.getAttribute(name);
          if (value && ja.test(value)) result.push({ kind: "attr", element: `${describe(element)} ${name}`, value });
        }
      }
      return result;
    });
    screens.push(screen);
    for (const item of found) findings.push({ screen, ...item });
    if (errors.length) findings.push({ screen, kind: "pageerror", element: "window", value: errors.splice(0).join("; ") });
  };
  const open = async (url) => { await tab.goto(`${origin}${url}`, { waitUntil: "networkidle" }); };
  const view = (name) => tab.getByRole("button", { name, exact: true }).click();

  await open("/en/pages/guide/");
  await tab.getByRole("heading", { level: 1, name: "Guide" }).waitFor();
  await scan("document view");

  await tab.getByRole("button", { name: "Edit", exact: true }).click();
  await tab.locator('[contenteditable="true"]').first().waitFor();
  await scan("document edit");
  await tab.getByRole("button", { name: "Cancel", exact: true }).first().click();

  await tab.getByRole("button", { name: /^Settings/ }).first().click();
  await scan("settings");

  await open("/en/pages/guide/");
  await tab.getByRole("button", { name: /search/i }).first().click();
  const search = tab.getByRole("dialog");
  await search.waitFor();
  await search.getByRole("searchbox").or(search.getByRole("textbox")).or(search.getByRole("combobox")).first().fill("guide");
  await tab.waitForTimeout(300);
  await scan("search dialog");
  await tab.keyboard.press("Escape");

  await open("/en/pages/tracker/");
  await view("Ticket list");
  await tab.getByRole("button", { name: /^Filters/ }).click();
  await scan("ticket list (filters open)");

  await view("Kanban");
  await scan("kanban");

  await view("WBS");
  await scan("wbs");

  await view("Ticket list");
  await tab.getByRole("button", { name: "Plan the release", exact: true }).first().click();
  await tab.getByRole("heading", { level: 1, name: "Plan the release" }).waitFor();
  await scan("ticket detail");

  await open("/en/pages/tracker/");
  await view("Tracker settings");
  await scan("tracker settings");

  await tab.getByRole("button", { name: /^Changes \(/ }).first().click();
  await tab.waitForTimeout(300);
  await scan("changes (git)");

  await open("/en/pages/guide/?history");
  await tab.getByRole("listbox").waitFor();
  await scan("document history");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await rm(root, { recursive: true, force: true });
}

if (findings.length) {
  process.stderr.write(`${JSON.stringify({ ok: false, screens, findings }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true, screens })}\n`);
