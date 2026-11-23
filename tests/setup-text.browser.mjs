// Run after npm run build: node tests/setup-text.browser.mjs
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "setup-text-"));
const config = path.join(root, "vellym.config.yaml");

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
      const response = await fetch(`${base}/api/v1/bootstrap`);
      if (response.ok && (await response.json()).data.state === "setup") break;
    } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: "ja-JP",
    viewport: { width: 1440, height: 900 }
  });
  await page.goto(base, { waitUntil: "networkidle" });
  const screen = page.locator('section[aria-labelledby="setup-title"]');

  await expect(screen.getByRole("heading", { level: 1, name: "開始方法と基本情報" })).toBeVisible();
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await expect(screen.getByRole("heading", { level: 1, name: "おすすめ構成" })).toBeVisible();
  await expect(screen.getByText("標準（おすすめ）", { exact: true })).toBeVisible();
  await expect(screen).not.toContainText(
    "管理量を選びます。標準をおすすめします。生成する階層をそのまま確認できます。"
  );

  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await expect(screen.getByRole("heading", { level: 1, name: "生成内容の確認" })).toBeVisible();
  await expect(screen.getByRole("status")).toHaveText(
    /作成 \d+件・既存のため作成しない \d+件・競合 \d+件/
  );
  await expect(screen).not.toContainText(
    "生成する階層だけを表示しています。名前を確認し、不要なものは解除してください。"
  );
  await expect(screen).not.toContainText(
    "既存のファイルは上書きしません。「この内容で生成」を押すまで、ファイルは書き込みません。"
  );

  await page.getByRole("button", { name: "戻る", exact: true }).click();
  await page.getByRole("button", { name: "戻る", exact: true }).click();
  await page.getByRole("combobox").first().selectOption("en");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(screen.getByRole("heading", { level: 1, name: "Recommended structure" })).toBeVisible();
  await expect(screen.getByText("Standard (recommended)", { exact: true })).toBeVisible();
  await expect(screen).not.toContainText(
    "Choose how much to manage. Standard is recommended. The hierarchy below is what gets created."
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(screen.getByRole("heading", { level: 1, name: "Review generated content" })).toBeVisible();
  await expect(screen.getByRole("status")).toHaveText(
    /Create \d+ · Keep existing \d+ · Conflicts \d+/
  );
  await expect(screen).not.toContainText(
    "Only the hierarchy to be created is shown. Review the names and clear anything you do not need."
  );
  await expect(screen).not.toContainText(
    'Existing files are never overwritten. Nothing is written until you press "Create project".'
  );

  if (server.exitCode !== null) throw new Error(`dev exited with ${server.exitCode}\n${output}`);
  console.log("Setup text: Japanese and English explanations removed, recommendation marker and review counts retained: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
