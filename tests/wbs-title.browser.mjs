// Run after npm run build: node tests/wbs-title.browser.mjs
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "wbs-title-"));
const content = path.join(root, "content");
const config = path.join(root, "vellym.config.yaml");
const port = 4196;
const base = `http://127.0.0.1:${port}`;
let server;
let browser;
let output = "";
try {
  await mkdir(content);
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  await cp("how-to-use/content/demo-tickets", path.join(content, "demo-tickets"), { recursive: true });
  await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: ja\nplugins:\n  - "@vellym/tickets"\n  - "@vellym/wbs"\n');
  server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)]);
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/ja/pages/demo-tickets/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "WBS", exact: true }).click();
  const title = page.locator(".wbs-title").first();
  await expect(title).toBeVisible();

  const styles = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      backgroundColor: style.backgroundColor,
      color: style.color,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(styles.borderStyle === "none" || styles.borderWidth === "0px").toBe(true);
  expect(styles.backgroundColor === "rgba(0, 0, 0, 0)" || styles.backgroundColor === "transparent").toBe(true);
  expect(styles.textOverflow).toBe("ellipsis");
  expect(styles.whiteSpace).toBe("nowrap");
  expect(await title.evaluate((element) => getComputedStyle(element).color))
    .toBe(await title.evaluate((element) => getComputedStyle(element.parentElement).color));

  await title.hover();
  await expect.poll(() => title.evaluate((element) => getComputedStyle(element).textDecorationLine)).toContain("underline");
  await title.focus();
  await expect(title).toBeFocused();
  const before = page.url();
  await title.press("Enter");
  await expect(page).not.toHaveURL(before);
  console.log("WBS titles have link styling, preserve focus and open on Enter: passed");
} finally {
  await browser?.close();
  server?.kill();
  await rm(root, { recursive: true, force: true });
}
