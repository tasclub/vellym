// Run after npm run build: node tests/related-commits.browser.mjs
// A ticket's detail lists the commits whose message names it (ticket-01m6sy034fzn60bv6ayw7sbg2n).
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "vellym-related-commits-"));
const write = async (file, text) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
};
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await write(".gitignore", "node_modules\n");
await write("vellym.config.yaml", 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins:\n  - "@vellym/tickets"\n');
await write("content/tracker.yaml", "apiVersion: vellym.tasclub.com/v1\nkind: TicketTracker\nmetadata: { name: tracker, title: Work }\nspec:\n  statuses:\n    - { id: open, label: Open, category: open }\n  fields: []\n");
const ticket = (name, title) => `apiVersion: vellym.tasclub.com/v1\nkind: Ticket\nmetadata: { name: ${name}, title: ${title} }\nspec:\n  status: open\n  blocks:\n    - { id: body, type: rich-text, content: "Body" }\n`;
await write("content/+tickets/ticket-01aaaa.yaml", ticket("ticket-01aaaa", "Write the notes"));
await write("content/+tickets/ticket-01bbbb.yaml", ticket("ticket-01bbbb", "Quiet ticket"));
git("init", "-q");
git("config", "user.name", "Related commits test");
git("config", "user.email", "related@example.invalid");
git("config", "commit.gpgSign", "false");
git("add", "."); git("commit", "-qm", "Add tickets");
await write("src/notes.txt", "one\n");
git("add", "."); git("commit", "-qm", "Draft notes for ticket-01aaaa");
await write("src/notes.txt", "two\n");
git("add", "."); git("commit", "-qm", "Polish notes", "-m", "Refs: ticket-01aaaa");
await write("src/notes.txt", "three\n");
git("add", "."); git("commit", "-qm", "Mention ticket-01aaaab, which is another name");

const port = 4198;
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/en/pages/ticket-01aaaa/`, { waitUntil: "networkidle" });
  const section = page.locator('section[aria-labelledby="plugin-related-commits"]');
  await expect(section.getByRole("heading")).toHaveText("Related commits");
  await expect(section.getByRole("listitem")).toHaveCount(2);
  await expect(section).toContainText("Polish notes");
  await expect(section).toContainText("Draft notes for ticket-01aaaa");
  await expect(section).not.toContainText("another name");

  await page.goto(`${base}/en/pages/ticket-01bbbb/`, { waitUntil: "networkidle" });
  await expect(page.locator('section[aria-labelledby="plugin-related-commits"]')).toContainText("No commits contain this page's name.");
  const missing = await fetch(`${base}/api/v1/git/mentions?name=ticket-unknown`);
  expect(missing.status).toBe(404);
  console.log("Related commits: exact-name matches in subject and body, none for others, 404 for unknown names: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
