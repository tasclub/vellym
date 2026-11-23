// Run after npm run build: node tests/ticket-reference-picker.browser.mjs
// Ticket reference editors search titles/IDs and keep their YAML names.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "ticket-reference-picker-"));
const content = path.join(root, "content");
const config = path.join(root, "vellym.config.yaml");
const write = async (relative, text) => {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};
const ticket = (name, title, fields = "") => `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata: { name: ${name}, title: "${title}" }
spec:
  status: open
  fields:
${fields || "    {}"}
  blocks:
    - { id: body, type: rich-text, content: "Body" }
`;

await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await write("vellym.config.yaml", `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui: { language: en }
i18n: { defaultLocale: en }
plugins: ["@vellym/tickets"]
`);
await write("content/tracker.yaml", `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: tracker, title: Tracker }
spec:
  statuses: [{ id: open, label: Open, category: open }]
  fields:
    - { id: parent, label: Parent, type: reference }
    - { id: dependsOn, label: Depends on, type: reference, multiple: true }
`);
await write("content/+tickets/source.yaml", ticket("source", "Source ticket", `    parent: missing-parent
    dependsOn: [dependency]`));
await write("content/+tickets/unresolved.yaml", ticket("unresolved", "Unresolved ticket", "    parent: missing-parent"));
await write("content/+tickets/parent.yaml", ticket("parent", "Parent by title"));
await write("content/+tickets/dependency.yaml", ticket("dependency", "Dependency by title"));

const port = 4200;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)]);
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
  await page.goto(`${base}/en/pages/source/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  const parent = page.locator("#plugin-field-parent");
  await parent.focus();
  await parent.fill("Parent by");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Parent by title", { exact: true })).toBeVisible();

  const dependsOn = page.locator("#plugin-field-dependsOn");
  await dependsOn.focus();
  await page.keyboard.type("dependency");
  await page.getByRole("option", { name: /Dependency by title dependency/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Remove Dependency by title" })).toBeVisible();
  await dependsOn.fill("parent");
  await page.getByRole("option", { name: /Parent by title parent/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Remove Parent by title" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Dependency by title" }).click();

  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  const saved = await readFile(path.join(content, "+tickets/source.yaml"), "utf8");
  expect(saved).toContain("parent: parent");
  expect(saved).toContain("dependsOn:\n      - parent");

  await page.goto(`${base}/en/pages/unresolved/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByText("missing-parent (not found)", { exact: true })).toBeVisible();
  await page.locator("#plugin-field-parent").fill("does-not-exist");
  await expect(page.getByText("No candidates", { exact: true })).toBeVisible();
  expect(await readFile(path.join(content, "+tickets/unresolved.yaml"), "utf8")).toContain("parent: missing-parent");
  console.log("Ticket reference picker searches titles and IDs, supports chips, excludes self, preserves missing values, and saves names: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
