// Run after npm run build.
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { parse } from "yaml";

const root = await mkdtemp(path.join(tmpdir(), "wbs-quickadd-"));
const content = path.join(root, "content");
await mkdir(content);
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await cp("how-to-use/content/demo-tickets", path.join(content, "demo-tickets"), { recursive: true });
const config = path.join(root, "vellym.config.yaml");
await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: ja\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/wbs"\n');
const port = 4195;
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/ja/pages/demo-tickets/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "WBS", exact: true }).click();
  const url = page.url();
  await page.getByRole("button", { name: "＋ Add", exact: true }).click();
  const title = page.getByRole("textbox", { name: "New task title", exact: true });
  const form = page.locator(".wbs-quick-add");
  await expect(form.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  for (let i = 0; i < 3; i++) {
    await title.fill(`Quick root ${i}`);
    if (i === 1) await form.locator("#wbs-add-start").fill("2026-11-25");
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await expect(title).toHaveValue("");
    await expect(title).toBeFocused();
    expect(page.url()).toBe(url);
    await expect(page.locator("[data-ticket-name]").filter({ hasText: `Quick root ${i}` })).toHaveCount(1);
  }
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  const parent = page.locator("[data-ticket-name]").filter({ hasText: "Quick root 0" });
  const parentName = await parent.getAttribute("data-ticket-name");
  await parent.getByRole("button", { name: /: Row actions$/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Add child task", exact: true }).click();
  await title.fill("Quick child");
  await title.press("Enter");
  await expect(title).toHaveValue("");
  await expect(title).toBeFocused();
  const files = await readdir(path.join(content, "demo-tickets/+tickets"));
  const tickets = await Promise.all(files.filter((f) => f.endsWith(".yaml")).map(async (file) =>
    parse(await readFile(path.join(content, "demo-tickets/+tickets", file), "utf8"))));
  const created = tickets.filter((t) => t.metadata.title.startsWith("Quick "));
  expect(created).toHaveLength(4);
  expect(created.find((t) => t.metadata.title === "Quick root 1").spec.fields.start).toBe("2026-11-25");
  expect(created.find((t) => t.metadata.title === "Quick child").spec.fields.parent).toBe(parentName);
  for (const ticket of created) {
    expect(ticket.spec.status).toBe("todo");
    expect(ticket.spec.fields.priority).toBe("high");
    expect(ticket.spec.blocks[0].content).toContain("目的");
  }
  const dimensions = await form.evaluate((element) => {
    const row = element.getBoundingClientRect();
    return { height: row.height, controls: [...element.querySelectorAll("input, select, button")].map((el) => {
      const rect = el.getBoundingClientRect(); return { height: rect.height, width: rect.width };
    }) };
  });
  expect(dimensions.height).toBe(36);
  expect(dimensions.controls.every((c) => c.height <= 36 && c.width > 0)).toBe(true);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "WBS", exact: true }).click();
  await expect(page.getByRole("button", { name: "＋ Add", exact: true })).toBeVisible();
  console.log("WBS quick add: three roots, child, optional date, defaults, focus, fixed row layout and no navigation: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
