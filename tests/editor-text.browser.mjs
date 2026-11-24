// Run after npm run build: node tests/editor-text.browser.mjs
// Page settings use a live URL preview and a fixed extension; empty and related-commit
// states no longer rely on explanatory paragraphs.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const pageRoot = await mkdtemp(path.join(tmpdir(), "editor-text-page-"));
const emptyRoot = await mkdtemp(path.join(tmpdir(), "editor-text-empty-"));
await symlink(path.resolve("node_modules"), path.join(pageRoot, "node_modules"), "dir");

async function write(root, file, text) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startProject(root) {
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [
    "packages/vellym/dist/cli.mjs",
    "dev",
    "--config",
    path.join(root, "vellym.config.yaml"),
    "--port",
    String(port)
  ]);
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${base}/api/v1/repository`)).ok) return { base, server };
    } catch {}
    if (server.exitCode !== null || attempt > 100) {
      server.kill();
      throw new Error(`Could not start the dev server:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

await write(pageRoot, "vellym.config.yaml", `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui:
  language: ja
i18n:
  defaultLocale: ja
plugins:
  - "@vellym/tickets"
`);
await write(pageRoot, "content/tracker.yaml", `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: tracker, title: Work }
spec:
  statuses:
    - { id: open, label: Open, category: open }
  fields: []
`);
await write(pageRoot, "content/page.yaml", `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: page-id
  title: Test page
  slug: old-name
spec:
  locale: ja
  blocks:
    - id: body
      type: rich-text
      content: "Page content"
`);
const ticketName = "ticket-01aaaa";
await write(pageRoot, `content/+tickets/${ticketName}.yaml`, `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata: { name: ${ticketName}, title: Related commit test }
spec:
  status: open
  blocks:
    - id: body
      type: rich-text
      content: "Ticket content"
`);
await write(emptyRoot, "vellym.config.yaml", `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui:
  language: ja
i18n:
  defaultLocale: ja
plugins: []
`);
await mkdir(path.join(emptyRoot, "content"));

const git = (...args) => execFileSync("git", args, { cwd: pageRoot, stdio: "pipe" });
git("init", "-q");
git("config", "user.name", "Editor text test");
git("config", "user.email", "editor-text@example.invalid");
git("config", "commit.gpgSign", "false");
git("add", ".");
git("commit", "-qm", "Add editor text fixtures");

let pageProject;
let emptyProject;
let browser;
try {
  pageProject = await startProject(pageRoot);
  emptyProject = await startProject(emptyRoot);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${pageProject.base}/ja/pages/old-name/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("button", { name: "ページ設定", exact: true }).click();
  const settings = page.getByRole("group", { name: "ページ設定" });
  const slugInput = page.getByLabel("URL名");
  await expect(settings.locator("output")).toHaveText("/pages/old-name/");
  await slugInput.fill("new-name");
  await expect(settings.locator("output")).toHaveText("/pages/new-name/");
  await slugInput.fill("");
  await expect(settings.locator("output")).toHaveText("/pages/page-id/");
  await expect(settings).not.toContainText("内部IDとは別の、URLに表示される変更可能な名前です。");

  const fileNameInput = page.getByLabel("YAMLファイル名");
  await expect(fileNameInput).toHaveValue("page");
  await expect(settings.getByText(".yaml", { exact: true })).toBeVisible();
  await fileNameInput.fill("page.yaml");
  await expect(fileNameInput).toHaveValue("page.yaml");
  await expect(settings).not.toContainText("URL名と内部IDには影響しません。.yamlは省略できます。");

  await page.goto(`${pageProject.base}/ja/pages/${ticketName}/`, { waitUntil: "networkidle" });
  const related = page.locator('section[aria-labelledby="plugin-related-commits"]');
  const relatedHeading = related.getByRole("heading", { name: "関連するコミット" });
  await expect(relatedHeading).toHaveAttribute(
    "title",
    `コミットメッセージにこのページの名前（${ticketName}）を書くと、ここに出ます。`
  );
  await expect(related.locator("p")).toHaveText("このページの名前を含むコミットはありません。");

  await page.goto(`${emptyProject.base}/ja/`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "まだ文書がありません" })).toBeVisible();
  await expect(page.getByRole("button", { name: "最初のPageを作る" })).toBeVisible();
  await expect(page.getByText("文書ツリーの「＋」から最初のページまたはフォルダを作成できます。")).toHaveCount(0);

  assert.equal(pageProject.server.exitCode, null);
  assert.equal(emptyProject.server.exitCode, null);
  console.log("Editor text: live URL preview, YAML suffix, concise empty state and related-commit tooltip: passed");
} finally {
  await browser?.close();
  for (const project of [pageProject, emptyProject]) {
    if (project && project.server.exitCode === null) project.server.kill();
  }
  await rm(pageRoot, { recursive: true, force: true });
  await rm(emptyRoot, { recursive: true, force: true });
}
