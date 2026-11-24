// Run after npm run build: node tests/rail-icons.browser.mjs
// The Git-change controls use recognizable icons and a dot only for pending changes.
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "rail-icons-"));
const remote = await mkdtemp(path.join(tmpdir(), "rail-icons-remote-"));
const content = path.join(root, "content");
const config = path.join(root, "vellym.config.yaml");
const screenshots = process.env.VELLYM_SCREENSHOT_DIR || path.join(root, "screenshots");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

await mkdir(content);
await writeFile(config, `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui:
  language: en
i18n:
  defaultLocale: en
plugins: []
`);
await writeFile(path.join(content, "page.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: page
  title: Rail icon check
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: |
        Rail icon browser check.
`);
execFileSync("git", ["init", "-q", "--bare", remote]);
git("init", "-q");
git("config", "user.name", "Rail Icons Test");
git("config", "user.email", "rail-icons@example.test");
git("config", "commit.gpgSign", "false");
git("branch", "-M", "main");
git("add", "content/page.yaml");
git("commit", "-qm", "initial page");
git("remote", "add", "origin", remote);
git("push", "-qu", "origin", "main");

const port = 4216;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  "packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)
]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });

let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${base}/api/v1/repository`)).ok) break;
    } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/en/pages/page/`, { waitUntil: "networkidle" });

  async function assertChangesButton(uncommitted, ahead, hasDot) {
    const name = `Changes (${uncommitted} uncommitted · ${ahead} unpushed)`;
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button.locator("svg")).toHaveCount(1);
    const icon = button.locator("svg");
    await expect(icon).toHaveAttribute("viewBox", "0 0 16 16");
    await expect(icon).toHaveAttribute("stroke", "currentColor");
    await expect(icon.locator("circle")).toHaveCount(3);
    expect(await button.evaluate((node) => node.innerText)).not.toMatch(/[⇅•]/);
    await expect(button.locator('span[aria-hidden="true"]')).toHaveCount(hasDot ? 1 : 0);
    return button;
  }

  // On a clean, wide screen the rail button has its existing label and no marker.
  let button = await assertChangesButton(0, 0, false);
  const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
  await expect(settingsButton.locator("svg")).toHaveCount(1);
  await expect(settingsButton.locator("svg")).toHaveAttribute("viewBox", "0 0 16 16");
  await expect(settingsButton.locator("svg")).toHaveAttribute("stroke", "currentColor");
  await expect(settingsButton.locator("svg circle")).toHaveCount(1);

  // An untracked file marks the desktop rail control.
  await writeFile(path.join(content, "pending.txt"), "pending\n");
  await page.reload({ waitUntil: "networkidle" });
  button = await assertChangesButton(1, 0, true);
  await mkdir(screenshots, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(screenshots, "rail-icons-1440.png") });

  // A local commit is still pending until pushed, so the mobile header keeps the dot.
  git("add", "content/pending.txt");
  git("commit", "-qm", "pending change");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  button = await assertChangesButton(0, 1, true);
  await page.screenshot({ path: path.join(screenshots, "rail-icons-390.png") });

  // Once pushed, neither narrow header nor wide rail displays the marker.
  git("push", "-q", "origin", "main");
  await page.reload({ waitUntil: "networkidle" });
  await assertChangesButton(0, 0, false);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "networkidle" });
  await assertChangesButton(0, 0, false);
  console.log("Git-change rail/header icons and pending markers at 1440px and 390px: passed");
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
}
