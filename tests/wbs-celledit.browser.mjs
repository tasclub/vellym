import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { parse } from "yaml";

const root = await mkdtemp(path.join(tmpdir(), "wbs-edit-"));
const content = path.join(root, "content"), config = path.join(root, "vellym.config.yaml");
const port = 4207, base = `http://127.0.0.1:${port}`;
let server, browser, output = "";
try {
  await mkdir(content);
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  await cp("how-to-use/content/demo-tickets", path.join(content, "demo-tickets"), { recursive: true });
  const dir = path.join(content, "demo-tickets/+tickets");
  for (let i = 0; i < 310; i++) {
    const name = `ticket-${String(i).padStart(26, "0")}`;
    await writeFile(path.join(dir, `${name}.yaml`), `apiVersion: vellym.tasclub.com/v1\nkind: Ticket\nmetadata:\n  name: ${name}\n  title: "AAA ${String(i).padStart(3, "0")}"\nspec:\n  status: todo\n  fields:\n    assignee: original\n`);
  }
  await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: ja\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/wbs"\n');
  server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)]);
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  for (let n = 0; ; n++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (n > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/ja/pages/demo-tickets/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "WBS", exact: true }).click();
  await page.getByText("WBS settings", { exact: true }).click();
  await page.getByRole("checkbox", { name: "担当" }).click();
  await expect(page.getByRole("columnheader", { name: "担当" })).toBeVisible();
  const name = `ticket-${"0".repeat(26)}`, row = page.locator(`[data-ticket-name="${name}"]`);
  await row.locator('[data-cell="start"] button').click();
  await row.locator('[data-cell="start"] input').fill("2026-11-23");
  await expect.poll(async () => parse(await readFile(path.join(dir, `${name}.yaml`), "utf8")).spec.fields.start).toBe("2026-11-23");
  await row.locator('[data-cell="assignee"] button').click();
  await row.locator('[data-cell="assignee"] input').fill("cancelled");
  await row.locator('[data-cell="assignee"] input').press("Escape");
  await expect(row.locator('[data-cell="assignee"]')).toContainText("original");
  await row.locator('[data-cell="assignee"] button').click();
  await row.locator('[data-cell="assignee"] input').fill("draft");
  const scroll = page.locator(".wbs-scroll");
  await scroll.evaluate((el) => { el.scrollTop = 10000; el.dispatchEvent(new Event("scroll")); });
  await expect(row).toHaveCount(0);
  await scroll.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
  await expect(row.locator('[data-cell="assignee"] input')).toHaveValue("draft");
  console.log("WBS cell editing: passed");
} finally {
  await browser?.close();
  server?.kill();
  await rm(root, { recursive: true, force: true });
}
