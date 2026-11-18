// Run after npm run build: node tests/shortcuts.browser.mjs
// Default keyboard shortcuts work and never take typed characters (ticket-01m7k6gftpkx2b781dtxtgfxtx).
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "vellym-shortcuts-"));
const write = async (file, text) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
};
const page = (name, title, body) => `apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: ${name}\n  title: ${title}\nspec:\n  locale: en\n  blocks:\n    - id: body\n      type: rich-text\n      content: ${body}\n`;
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await write("vellym.config.yaml", 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/kanban"\n');
await write("content/guide.yaml", page("guide", "Guide", "First body"));
await write("content/notes.yaml", page("notes", "Notes", "Second body"));
await write("content/tracker.yaml", "apiVersion: vellym.tasclub.com/v1\nkind: TicketTracker\nmetadata: { name: tracker, title: Work }\nspec:\n  statuses:\n    - { id: open, label: Open, category: open }\n    - { id: done, label: Done, category: closed }\n  fields: []\n");
for (const [name, title] of [["ticket-one", "First ticket"], ["ticket-two", "Second ticket"]]) {
  await write(`content/+tickets/${name}.yaml`, `apiVersion: vellym.tasclub.com/v1\nkind: Ticket\nmetadata: { name: ${name}, title: ${title} }\nspec:\n  status: open\n  blocks:\n    - { id: body, type: rich-text, content: "About ${title}" }\n`);
}

const port = 4197;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", path.join(root, "vellym.config.yaml"), "--port", String(port)]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error.message));

  // E starts editing, Ctrl+S saves and writes the file.
  await tab.goto(`${base}/en/pages/guide/`, { waitUntil: "networkidle" });
  await tab.getByRole("heading", { level: 1, name: "Guide" }).waitFor();
  await tab.locator("body").click({ position: { x: 5, y: 5 } });
  await tab.keyboard.press("e");
  const editor = tab.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await tab.keyboard.press("End");
  // In the editor, shortcut letters are typed characters.
  await tab.keyboard.type(" e[?");
  await expect(editor).toContainText("First body e[?");
  expect(await tab.getByRole("dialog").count()).toBe(0);
  await tab.keyboard.press("Control+s");
  await expect(tab.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  // Markdown escapes the bracket when saving.
  expect(await readFile(path.join(root, "content/guide.yaml"), "utf8")).toMatch(/First body e\\?\[\?/);

  // Ctrl+\ hides and shows the document tree.
  const closeTree = tab.getByRole("button", { name: "Close document navigation" });
  await expect(closeTree).toBeVisible();
  await tab.keyboard.press("Control+\\");
  await expect(tab.getByRole("button", { name: "Open document navigation" })).toBeVisible();
  await tab.keyboard.press("Control+\\");
  await expect(closeTree).toBeVisible();

  // / and Ctrl+K open search; inside the search field / is a character.
  await tab.keyboard.press("/");
  const search = tab.getByRole("dialog");
  await expect(search).toBeVisible();
  await tab.keyboard.type("a/b");
  await expect(search.getByRole("searchbox").or(search.getByRole("combobox")).or(search.getByRole("textbox")).first()).toHaveValue("a/b");
  await tab.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await tab.keyboard.press("Control+k");
  await expect(search).toBeVisible();
  await tab.keyboard.press("Escape");

  // ] and [ step through the views of a ticket tracker and stop at the ends.
  await tab.goto(`${base}/en/pages/tracker/`, { waitUntil: "networkidle" });
  const views = tab.getByRole("button", { name: /^(Kanban|Ticket list|Tracker settings)$/ });
  const pressed = async () => (await views.evaluateAll((buttons) => buttons
    .filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent)))[0];
  await expect(views.first()).toBeVisible();
  const order = await views.allInnerTexts();
  await tab.getByRole("button", { name: order[0], exact: true }).click();
  await expect.poll(pressed).toBe(order[0]);
  const start = order[0];
  await tab.locator("body").click({ position: { x: 5, y: 5 } });
  await tab.keyboard.press("]");
  await expect.poll(pressed).not.toBe(start);
  await tab.keyboard.press("[");
  await expect.poll(pressed).toBe(start);
  await tab.keyboard.press("[");
  await tab.waitForTimeout(300);
  expect(await pressed()).toBe(start);

  // ? opens the list, Escape closes it.
  await tab.keyboard.press("?");
  const help = tab.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(help.getByRole("table")).toContainText("Ctrl+K");
  await tab.keyboard.press("Escape");
  await expect(help).toBeHidden();

  // While an IME is composing, E does nothing.
  await tab.goto(`${base}/en/pages/notes/`, { waitUntil: "networkidle" });
  await tab.getByRole("heading", { level: 1, name: "Notes" }).waitFor();
  await tab.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", isComposing: true, bubbles: true })));
  await tab.waitForTimeout(300);
  expect(await tab.locator('[contenteditable="true"]').count()).toBe(0);

  if (errors.length) throw new Error(errors.join("; "));
  console.log("Shortcuts: E / Ctrl+S, typing in the editor, Ctrl+\\, / and Ctrl+K, [ and ], ?, IME composition: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
