import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { parse } from "yaml";

const root = await mkdtemp(path.join(tmpdir(), "tickets-settings-dnd-"));
const content = path.join(root, "content");
await mkdir(content);
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await cp("how-to-use/content/demo-tickets", path.join(content, "demo-tickets"), { recursive: true });
const tracker = path.join(content, "demo-tickets/demo-tickets.yaml");
const original = await readFile(tracker, "utf8");
const config = path.join(root, "vellym.config.yaml");
await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: ja\nplugins:\n  - "@vellym/tickets"\n');
const base = "http://127.0.0.1:4198";
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", "4198"]);
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
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/en/pages/demo-tickets/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Tracker settings", exact: true }).click();
  const statuses = page.locator('[data-row="status"]');
  const fields = page.locator('[data-row="field"]');
  const options = page.locator('[data-options-for="priority"] [data-row="option"]');
  await expect(page.locator(".tickets-settings-header.tickets-settings-status-grid span").first())
    .toHaveAttribute("title", "Do not change this ID after saving. Changing it makes tickets using this value undefined.");
  await expect(statuses.nth(0).locator('[data-marker="default"]')).toHaveText("Default");
  await expect(statuses.nth(1).locator('[data-marker="default"]')).toHaveCount(0);
  await expect(statuses.nth(0).locator('[data-marker="usage"]')).toHaveText(/\d+ in use/);
  await expect(statuses.nth(0).locator('[role="status"]')).toHaveCount(0);
  await expect(options.nth(0).locator('[data-marker="default"]')).toHaveText("Default");
  async function drag(source, target, below) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    await source.locator('[draggable="true"]').dragTo(target, {
      targetPosition: { x: box.width - 10, y: below ? box.height - 5 : 5 }
    });
  }
  await drag(statuses.nth(0), statuses.nth(2), true);
  await drag(fields.nth(1), fields.nth(0), false);
  await drag(options.nth(0), options.nth(1), true);
  await drag(statuses.nth(0), options.nth(0), true);
  await expect(statuses.nth(0).locator('input').first()).toHaveValue("doing");
  await expect(statuses.nth(0).locator('[data-marker="default"]')).toHaveText("Default");
  await expect(statuses.nth(2).locator('[data-marker="default"]')).toHaveCount(0);
  await expect(options.nth(0).locator('input').first()).toHaveValue("mid");
  await expect(options.nth(0).locator('[data-marker="default"]')).toHaveText("Default");
  await expect(options.nth(1).locator('[data-marker="default"]')).toHaveCount(0);
  const handle = page.getByRole("button", { name: "Reorder: finish" });
  await handle.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(handle).toBeFocused();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(handle).toBeFocused();
  expect(await readFile(tracker, "utf8")).toBe(original);
  await expect(statuses.nth(2).locator("input").first()).toHaveValue("todo");
  await expect(fields.nth(0).locator("input").first()).toHaveValue("assignee");
  await expect(options.nth(1).locator("input").first()).toHaveValue("high");
  const todoRow = statuses.filter({ has: page.locator('input[value="todo"]') });
  await todoRow.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(todoRow.getByRole("status")).toContainText("6 tickets are using this value. Removing it leaves them undefined.");
  await expect(todoRow.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await expect(todoRow.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await todoRow.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(todoRow.getByRole("status")).toHaveCount(0);
  await todoRow.getByRole("button", { name: "Remove", exact: true }).click();
  await todoRow.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(statuses).toHaveCount(3);
  const firstOption = options.nth(0);
  await expect(firstOption.locator('[data-marker="usage"]')).toHaveText(/\d+ in use/);
  await firstOption.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(firstOption.getByRole("status")).toContainText("tickets are using this value.");
  await firstOption.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await readFile(tracker, "utf8")).toBe(original);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const saved = parse(await readFile(tracker, "utf8"));
  expect(saved.spec.statuses.map((row) => row.id)).toEqual(["doing", "done", "finish"]);
  expect(saved.spec.fields.slice(0, 2).map((row) => row.id)).toEqual(["assignee", "priority"]);
  expect(saved.spec.fields[1].options.map((row) => row.value)).toEqual(["mid", "high", "low"]);
  expect(saved.spec.fields[1].options.every((row) => !("key" in row))).toBe(true);
  console.log("Settings drag and save: passed");
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
