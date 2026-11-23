// Run after npm run build: node tests/admin-text.browser.mjs
// Settings use concise copy, plain read-only source values and useful path tooltips.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "admin-text-"));
const content = path.join(root, "content");
await mkdir(path.join(content, "_archive"), { recursive: true });

function page(name, title, slug) {
  return `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: ${name}
  title: ${title}
${slug ? `  slug: ${slug}\n` : ""}spec:
  locale: ja
  blocks: []
`;
}

await writeFile(path.join(content, "one.yaml"), page("one", "Home", "home"));
await writeFile(path.join(content, "migrate-one.yaml"), page("migrate-one", "First migration"));
await writeFile(path.join(content, "migrate-two.yaml"), page("migrate-two", "Second migration"));
await writeFile(path.join(content, "already-named.yaml"), page("already-named", "Already named", "custom-url"));
await writeFile(
  path.join(content, "unhandled.yaml"),
  `apiVersion: vellym.tasclub.com/v1
kind: Memo
metadata:
  name: unhandled
  title: Unhandled memo
  slug: unhandled-memo
spec:
  locale: ja
  blocks: []
`
);
await writeFile(
  path.join(content, "_archive", "archived.yaml"),
  page("archived", "Archived item", "archived-item")
);
const config = path.join(root, "vellym.config.yaml");
await writeFile(config, `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui:
  language: ja
i18n:
  defaultLocale: ja
plugins: []
`);

const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
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
  await page.goto(`${base}/ja/pages/one/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^設定/ }).click();

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "設定・管理詳細" })).toBeVisible();
  const sourceInfo = main.locator('section[aria-labelledby="source-title"]');
  await expect(sourceInfo.locator("code").nth(0)).toHaveText(root);
  await expect(sourceInfo.locator("code").nth(1)).toHaveText(path.basename(config));
  const contentRootValue = sourceInfo.getByText("content", { exact: true });
  await expect(contentRootValue).toHaveAttribute("title", content);
  await expect(sourceInfo).toContainText("コンテンツ保存先");
  await expect(sourceInfo).toContainText("ローカルYAMLへ書き込み（commitは行いません）");
  await expect(sourceInfo.locator("input, select, textarea")).toHaveCount(0);
  await expect(sourceInfo.locator("p")).toHaveCount(0);

  await expect(main.getByRole("heading", { name: "構成テンプレートを追加" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "アーカイブ済み" })).toBeVisible();
  const archivedRow = main.locator('section[aria-labelledby="archived-title"] li')
    .filter({ hasText: "Archived item" });
  await expect(archivedRow).toBeVisible();
  await page.route("**/api/v1/structure/plan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { executable: false }, diagnostics: [] })
  }));
  await archivedRow.getByRole("button", { name: "復元", exact: true }).click();
  await expect(archivedRow.getByRole("alert")).toHaveText("復元できませんでした。");
  await expect(main.locator('section[aria-labelledby="archived-title"] > p[role="alert"]')).toHaveCount(0);
  await page.unroute("**/api/v1/structure/plan");
  await expect(main).toContainText("作成済みの文書の言語は変わりません。");
  await expect(main).toContainText("どのプラグインも解釈しないkindです。検索とリンクから開けます。");
  for (const removed of [
    "ソース情報や読み込み状態を確認し、",
    "この画面では変更できません",
    "画面の表示言語を切り替えます。",
    "必要になったFolderとPageだけを選んで追加します。",
    "個々のページのURL名は各ページの編集画面",
    "アーカイブした文書・フォルダを元の場所に戻します。",
    "文書ツリーには出ませんが、本文だけの文書として検索とリンクから開けます。"
  ]) {
    await expect(main).not.toContainText(removed);
  }

  await main.getByRole("button", { name: "変更内容を確認", exact: true }).click();
  const applyRoot = main.getByRole("button", { name: "保存先を変更", exact: true });
  await expect(applyRoot).toBeVisible();
  await expect(applyRoot.locator("..").locator("small")).toHaveText("既存のファイルは移動しません。");

  const slugSection = main.locator("details").filter({ hasText: "URL名が未設定のページに一括で追加" });
  await slugSection.locator("summary").click();
  await slugSection.getByRole("button", { name: "URL名の移行内容を確認", exact: true }).click();
  const jaSlugApply = slugSection.getByRole("button", { name: "URL名を付ける（2件）", exact: true });
  await expect(jaSlugApply).toBeVisible();
  await expect(slugSection).toContainText("2ページ");
  await expect(slugSection).not.toContainText("個々のページのURL名は");

  await main.locator("select").selectOption("en");
  await main.getByRole("button", { name: "この言語に切り替える", exact: true }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Settings & admin details" })).toBeVisible();
  const enSourceInfo = main.locator('section[aria-labelledby="source-title"]');
  await expect(enSourceInfo.getByText("content", { exact: true })).toHaveAttribute("title", content);
  await expect(main).toContainText("Existing documents keep their language.");
  await expect(main).toContainText("No plugin interprets this kind, but you can open it from search and links.");
  const enApplyRoot = main.getByRole("button", { name: "Change location", exact: true });
  await expect(enApplyRoot.locator("..").locator("small")).toHaveText("Existing files are not moved.");
  const enSlugSection = main.locator("details").first();
  await expect(enSlugSection.getByRole("button", { name: "Add URL names (2)", exact: true })).toBeVisible();
  for (const removed of [
    "View source information and loading status,",
    "it cannot be changed here.",
    "Switches the interface language.",
    "Choose and add only the Folders and Pages you need.",
    "Each page's URL name can also be changed any time",
    "Move archived documents and folders back to their original location.",
    "stay out of the document tree but open as body-only documents"
  ]) {
    await expect(main).not.toContainText(removed);
  }

  await enSlugSection.getByRole("button", { name: "Add URL names (2)", exact: true }).click();
  await expect(enSlugSection.getByRole("status")).toHaveText("Added URL names to 2 page(s)");
  await enSlugSection.getByRole("button", { name: "Preview URL name migration", exact: true }).click();
  await expect(enSlugSection).toContainText("No pages need migration");
  await expect(enSlugSection.getByRole("button", { name: /Add URL names/ })).toHaveCount(0);

  assert.equal(server.exitCode, null);
  console.log("Admin text: concise Japanese/English settings, read-only source values, absolute-path tooltip, inline warning and slug-count actions: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
