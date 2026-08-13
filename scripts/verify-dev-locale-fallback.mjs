import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const project = await mkdtemp(path.join(tmpdir(), "vellym-locale-fallback-"));
const content = path.join(project, "content");
await mkdir(content);
await writeFile(path.join(project, "vellym.config.yaml"), `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui:
  language: ja
i18n:
  defaultLocale: ja
plugins: []
`);
await writeFile(path.join(content, "_index.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Folder
metadata:
  title: 文書
spec:
  order: [overview.yaml, ja-only.yaml]
`);
await writeFile(path.join(content, "overview.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: overview
  title: 概要
spec:
  locale: ja
  blocks:
    - { id: body, type: rich-text, format: commonmark, content: 日本語概要 }
  translations:
    en:
      title: Overview
      blocks:
        - { id: body, type: rich-text, format: commonmark, content: English overview }
`);
await writeFile(path.join(content, "ja-only.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: ja-only
  title: 日本語のみ
spec:
  locale: ja
  blocks:
    - { id: body, type: rich-text, format: commonmark, content: 既定言語だけの検索語 }
`);

const port = 4182;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  "packages/vellym/dist/cli.mjs", "dev",
  "--config", path.join(project, "vellym.config.yaml"),
  "--host", "127.0.0.1", "--port", String(port)
], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });

try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (attempt === 99) throw new Error("dev server did not become ready");
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/ja/pages/overview/`, { waitUntil: "networkidle" });
    const before = await page.getByRole("treegrid").getByRole("row").count();
    await page.locator(".language-switcher").getByRole("link", { name: "English" }).click();
    await page.waitForURL(`${origin}/en/pages/overview/`);
    await page.waitForFunction(() =>
      document.querySelectorAll('[role="treegrid"] [role="row"]').length === 2
    );
    const after = await page.getByRole("treegrid").getByRole("row").count();
    if (before !== 2 || after !== 2) throw new Error(`tree count mismatch: ${before}/${after}`);

    await page.getByRole("treegrid").getByText("日本語のみ", { exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "日本語のみ" }).waitFor();
    if (await page.locator(".language-switcher").count()) {
      throw new Error("single-locale Page shows a language switcher");
    }

    await page.getByRole("button", { name: /Search all documents|全文検索/ }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("既定言語だけの検索語");
    await page.getByRole("option", { name: /日本語のみ/ }).waitFor();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      pageCount: after,
      fallbackHeading: "日本語のみ",
      switcherHidden: true,
      fallbackSearch: true
    })}\n`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
  await rm(project, { recursive: true, force: true });
}
