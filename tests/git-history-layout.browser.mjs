// Run after npm run build: node tests/git-history-layout.browser.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "git-history-layout-"));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
await mkdir(path.join(root, "content"));
await writeFile(path.join(root, "vellym.config.yaml"), 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
git("init", "-q");
git("config", "user.name", "History Tester");
git("config", "user.email", "history@example.test");
git("config", "commit.gpgSign", "false");
const subject = `Latest revision ${"長い件名の表示を確認".repeat(15)}`;
for (let revision = 0; revision < 3; revision++) {
  await writeFile(path.join(root, "content/page.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata: { name: page, title: 履歴のレイアウト }
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: |
        ## Heading
${Array.from({ length: 150 }, (_, n) => `        ${n}: 第${revision}版の日本語の文章 ${"長い行を折り返して表示する".repeat(5)}`).join("\n")}
`);
  git("add", "content");
  git("commit", "-qm", revision === 2 ? subject : `Revision ${revision}`);
}
const port = 4208, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", path.join(root, "vellym.config.yaml"), "--port", String(port)]);
let output = "", browser;
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${base}/en/pages/page/`);
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.locator("[data-git-history]");
  const diff = page.getByRole("region", { name: "Diff", exact: true });
  await expect(diff.locator("table")).toBeVisible();
  await expect(diff).toHaveAttribute("data-layout", "split");
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("option", { selected: true })).toHaveAttribute("aria-current", "true");
  const dimensions = await history.evaluate((node) => {
    const content = node.lastElementChild;
    const [list, panel] = content.children;
    const cells = panel.querySelector("table th").parentElement.querySelectorAll("td");
    const paper = node.parentElement;
    return {
      history: node.getBoundingClientRect().width,
      main: document.querySelector("main").getBoundingClientRect().width,
      list: list.getBoundingClientRect().width,
      diff: panel.getBoundingClientRect().width,
      text: [...cells].map((cell) => cell.clientWidth - parseFloat(getComputedStyle(cell).paddingLeft) - parseFloat(getComputedStyle(cell).paddingRight)),
      listOverflow: getComputedStyle(list).overflowY,
      diffOverflow: getComputedStyle(panel).overflowY,
      paperPadding: getComputedStyle(paper).padding,
      bottom: node.getBoundingClientRect().bottom
    };
  });
  expect(dimensions.history).toBe(dimensions.main);
  expect(dimensions.list).toBe(280);
  expect(dimensions.diff / dimensions.main).toBeGreaterThanOrEqual(.65);
  expect(dimensions.text).toHaveLength(2);
  for (const width of dimensions.text) expect(width).toBeGreaterThanOrEqual(400);
  expect(dimensions.listOverflow).toBe("auto");
  expect(dimensions.diffOverflow).toBe("auto");
  expect(dimensions.paperPadding).toBe("0px");
  expect(dimensions.bottom).toBeLessThanOrEqual(900);
  await expect(page.getByRole("navigation", { name: "Headings on this page" })).toHaveCount(0);
  const selected = page.getByRole("option", { selected: true });
  expect(await selected.getAttribute("title")).toContain(subject);
  expect(await selected.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(65);
  expect(await selected.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await selected.locator("[title]").first().evaluate((node) => getComputedStyle(node).textOverflow)).toBe("ellipsis");
  const shots = process.env.VELLYM_SCREENSHOT_DIR || tmpdir();
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, "git-history-1400.png") });

  // Resize only the tree: automatic layout must observe the diff, not the viewport.
  const separator = page.getByRole("separator", { name: "Document navigation width" });
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(diff).toHaveAttribute("data-layout", "unified");
  await page.keyboard.press("ArrowLeft");
  await expect(diff).toHaveAttribute("data-layout", "split");
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(diff).toHaveAttribute("data-layout", "unified");
  await page.getByRole("button", { name: "Side by side", exact: true }).click();
  await expect(diff).toHaveAttribute("data-layout", "split");
  await page.reload();
  await expect(diff).toHaveAttribute("data-layout", "split");
  await page.getByRole("button", { name: "One column", exact: true }).click();
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(diff).toHaveAttribute("data-layout", "unified");
  await page.reload();
  await expect(diff).toHaveAttribute("data-layout", "unified");

  await page.getByRole("option").nth(1).click();
  await expect(page.getByRole("option").nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("option").first()).not.toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Side by side", exact: true }).click();
  await expect(diff).toHaveAttribute("data-layout", "split");
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(diff).toHaveAttribute("data-layout", "unified");
  const mobile = await history.evaluate((node) => {
    const [list, panel] = node.lastElementChild.children;
    const a = list.getBoundingClientRect(), b = panel.getBoundingClientRect();
    return { listBottom: a.bottom, diffTop: b.top, listHeight: a.height, bottom: b.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(mobile.listBottom).toBeLessThanOrEqual(mobile.diffTop);
  expect(mobile.listHeight).toBeLessThan(250);
  expect(mobile.bottom).toBeLessThanOrEqual(900);
  expect(mobile.overflow).toBe(false);
  await page.screenshot({ path: path.join(shots, "git-history-390.png") });
  await page.setViewportSize({ width: 390, height: 600 });
  const scrolling = await history.evaluate((node) => {
    const [list, panel] = node.lastElementChild.children;
    const listBefore = list.scrollTop;
    panel.scrollTop = 300;
    const diffAfter = panel.scrollTop;
    const listAfter = list.scrollTop;
    list.scrollTop = 100;
    return { listBefore, listAfter, listScrolled: list.scrollTop, diffAfter, diffFinal: panel.scrollTop };
  });
  expect(scrolling.diffAfter).toBeGreaterThan(0);
  expect(scrolling.listAfter).toBe(scrolling.listBefore);
  expect(scrolling.listScrolled).toBeGreaterThan(0);
  expect(scrolling.diffFinal).toBe(scrolling.diffAfter);
  await page.getByRole("button", { name: "Back to document", exact: true }).click();
  await expect(history).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "履歴のレイアウト", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.getByRole("navigation", { name: "Headings on this page" })).toBeVisible();
  expect(await page.locator(".document-paper").evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft))).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  console.log("History layout: widths, column text, tree resize, selection, preferences/reload, mobile: passed", dimensions);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  await rm(root, { recursive: true, force: true });
}
