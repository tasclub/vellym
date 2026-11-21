// Run after npm run build: node tests/document-outline-copy.browser.mjs
// Copy a heading URL and ensure opening it in a new tab focuses the heading.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "vellym-outline-copy-"));
const content = path.join(root, "content");
const config = path.join(root, "vellym.config.yaml");
const cli = path.resolve("packages/vellym/dist/cli.mjs");
const errors = [];
let dynamicServer;
let staticServer;
let browser;

async function freePort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) =>
    probe.close((error) => error ? reject(error) : resolve())
  );
  return port;
}

function serveStatic(output) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  };
  return createHttpServer(async (request, response) => {
    try {
      // Build output paths are URL-encoded, so keep the encoded pathname for
      // filesystem lookup (e.g. pages/%E6%97%A5%E6%9C%AC%E8%AA%9E/).
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const file = path.resolve(output, `.${pathname}`);
      if (file !== output && !file.startsWith(`${output}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const fileStat = await stat(file);
      const target = fileStat.isDirectory() ? path.join(file, "index.html") : file;
      response.setHeader("content-type", types[path.extname(target)] ?? "application/octet-stream");
      createReadStream(target).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
}

try {
  await mkdir(content, { recursive: true });
  await writeFile(config, `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui:
  language: ja
i18n:
  defaultLocale: ja
plugins: []
`);
  await writeFile(path.join(content, "focus-guide.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: focus-guide
  title: Focus guide
spec:
  locale: ja
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: |
        ## First heading

        First section.

        ## 日本語の見出し

        Target section.
`);

  const port = await freePort();
  const dynamicOrigin = `http://127.0.0.1:${port}`;
  dynamicServer = spawn(process.execPath, [cli, "dev", "--config", config, "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverOutput = "";
  dynamicServer.stdout.on("data", (chunk) => { serverOutput += chunk; });
  dynamicServer.stderr.on("data", (chunk) => { serverOutput += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${dynamicOrigin}/api/v1/bootstrap`, {
        signal: AbortSignal.timeout(800)
      });
      if (response.ok) { ready = true; break; }
    } catch {}
    if (dynamicServer.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, `dev server did not start: ${serverOutput}`);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ja-JP",
    viewport: { width: 1440, height: 900 }
  });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(10_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: dynamicOrigin });

  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`dynamic: ${error.message}`));
  await page.goto(`${dynamicOrigin}/ja/pages/focus-guide/`, { waitUntil: "networkidle" });
  const outline = page.getByRole("navigation", { name: "このページの見出し" });
  const targetLink = outline.getByRole("link", { name: "日本語の見出し", exact: true });
  await targetLink.click();
  const target = page.getByRole("heading", { level: 2, name: "日本語の見出し", exact: true });
  await expect(target).toBeFocused();

  await outline.getByRole("button", { name: "現在の見出しへのリンクをコピー", exact: true }).click();
  await expect(outline.locator('[aria-live="polite"]')).toHaveText("リンクをコピーしました");
  const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copiedUrl, page.url(), "dynamic copied URL should be the current URL");
  const dynamicTab = await context.newPage();
  dynamicTab.on("pageerror", (error) => errors.push(`dynamic new tab: ${error.message}`));
  await dynamicTab.goto(copiedUrl, { waitUntil: "networkidle" });
  await expect(dynamicTab.getByRole("heading", { level: 2, name: "日本語の見出し", exact: true })).toBeFocused();

  const build = spawnSync(process.execPath, [cli, "build", "--config", config, "--json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000
  });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const output = JSON.parse(build.stdout).data.outputDir;
  staticServer = serveStatic(output);
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const staticOrigin = `http://127.0.0.1:${staticServer.address().port}`;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: staticOrigin });

  const staticPage = await context.newPage();
  staticPage.on("pageerror", (error) => errors.push(`static: ${error.message}`));
  await staticPage.goto(`${staticOrigin}/pages/focus-guide/`, { waitUntil: "networkidle" });
  const staticOutline = staticPage.getByRole("navigation", { name: "このページの見出し" });
  await staticOutline.getByRole("link", { name: "日本語の見出し", exact: true }).click();
  await staticOutline.getByRole("button", { name: "現在の見出しへのリンクをコピー", exact: true }).click();
  await expect(staticOutline.locator('[aria-live="polite"]')).toHaveText("リンクをコピーしました");
  const staticCopiedUrl = await staticPage.evaluate(() => navigator.clipboard.readText());
  assert.equal(staticCopiedUrl, staticPage.url(), "static copied URL should use the static page URL");
  assert.equal(new URL(staticCopiedUrl).origin, staticOrigin);

  const staticTab = await context.newPage();
  staticTab.on("pageerror", (error) => errors.push(`static new tab: ${error.message}`));
  await staticTab.goto(staticCopiedUrl, { waitUntil: "networkidle" });
  await expect(staticTab.getByRole("heading", { level: 2, name: "日本語の見出し", exact: true })).toBeFocused();

  assert.deepEqual(errors, []);
  console.log("Dynamic and static copied heading links open the same heading with focus: passed");
} finally {
  await browser?.close();
  if (dynamicServer?.exitCode === null) {
    dynamicServer.kill("SIGTERM");
    await Promise.race([
      once(dynamicServer, "exit"),
      new Promise((resolve) => setTimeout(() => {
        dynamicServer.kill("SIGKILL");
        resolve();
      }, 3000))
    ]);
  }
  if (staticServer?.listening) {
    await new Promise((resolve) => staticServer.close(resolve));
  }
  await rm(root, { recursive: true, force: true });
}
