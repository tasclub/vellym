// Run after npm run build: node tests/archive-preview.browser.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "archive-preview-"));
const content = path.join(root, "content");
await mkdir(path.join(content, "empty"), { recursive: true });
await mkdir(path.join(content, "full"));
const folder = (title) => `apiVersion: vellym.tasclub.com/v1\nkind: Folder\nmetadata:\n  title: ${title}\nspec:\n  locale: en\n`;
await writeFile(path.join(content, "full/_index.yaml"), folder("Full folder"));
const pageSource = "apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: sample\n  title: Sample page\nspec:\n  blocks: []\n";
await writeFile(path.join(content, "full/sample.yaml"), pageSource);
const config = path.join(root, "vellym.config.yaml");
await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins: []\n');
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });
let browser;
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
try {
  let base;
  for (let attempt = 0; attempt < 150; attempt++) {
    base = output.match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+/)?.[0];
    if (base) {
      try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    }
    if (attempt === 149) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  const dialog = page.getByRole("dialog");
  const archive = button(dialog, "Archive");
  const review = button(dialog, "Review");
  async function open(title) {
    await button(page.getByRole("treegrid"), `Actions for ${title}`).click();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(dialog).toBeVisible();
  }
  async function cancel() {
    await button(dialog, "Cancel").click();
    await expect(dialog).toBeHidden();
  }
  const previewUrl = "**/api/v1/structure/plan";
  const applyUrl = "**/api/v1/structure/apply";
  let previews = 0;
  let applies = 0;
  let displayedPlan;
  let sentPlan;
  page.on("request", (request) => {
    if (request.url().endsWith("/structure/plan")) previews++;
    if (request.url().endsWith("/structure/apply")) {
      applies++;
      sentPlan = request.postDataJSON().plan;
    }
  });
  async function capture(route) {
    const response = await route.fetch();
    const envelope = await response.json();
    displayedPlan = envelope.data;
    await route.fulfill({ response });
  }
  await page.route(previewUrl, capture);

  // Nonempty Folder: real paths, impact and server warning, no write before confirmation.
  await open("Full folder");
  await expect(archive).toBeEnabled();
  await expect(dialog).toContainText("_archive/full");
  await expect(dialog).toContainText("full");
  await expect(dialog).toContainText("Affected pages: 1");
  await expect(dialog).toContainText('After archiving, you can restore from "Archived" in Settings.');
  assert.equal(displayedPlan.affectedPages, 1);
  assert(displayedPlan.warnings.length > 0);
  for (const warning of displayedPlan.warnings) await expect(dialog).toContainText(warning);
  assert.equal(applies, 0);
  assert.equal(await readFile(path.join(content, "full/sample.yaml"), "utf8"), pageSource);
  // Check actual layout and retain a screen for the UI review.
  const bounds = await dialog.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
  });
  assert(bounds.width > 0 && bounds.height > 0);
  assert(bounds.scrollWidth <= bounds.clientWidth, JSON.stringify(bounds));
  await mkdir("dist/archive-preview", { recursive: true });
  await page.screenshot({ path: "dist/archive-preview/nonempty-folder.png" });
  console.log("Archive dialog bounds:", bounds);
  await cancel();

  // Empty Folder: real zero-page plan is still executable.
  await open("empty");
  await expect(archive).toBeEnabled();
  assert.equal(displayedPlan.affectedPages, 0);
  await expect(dialog).toContainText("Affected pages: 0");
  assert(!displayedPlan.warnings.some((warning) => warning.includes("空でない")));
  await expect(dialog).toContainText("_archive/empty");
  const confirmedEmpty = structuredClone(displayedPlan);
  const beforeEmpty = previews;
  await archive.click();
  await expect(dialog).toBeHidden();
  assert.equal(previews, beforeEmpty, "apply must not fetch another plan");
  assert.deepEqual(sentPlan, confirmedEmpty);

  // Failed preview: no apply is possible until an explicit successful review.
  await page.unroute(previewUrl);
  await page.route(previewUrl, (route) => route.fulfill({
    status: 500, json: { data: null, diagnostics: [{ code: "INTERNAL", message: "Preview unavailable" }] }
  }));
  await open("Full folder");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(archive).toBeDisabled();
  const beforeFailure = applies;
  await page.unroute(previewUrl);
  await page.route(previewUrl, capture);
  await review.click();
  await expect(archive).toBeEnabled();
  assert.equal(applies, beforeFailure);
  await cancel();

  // Non-executable preview cannot be applied; another review is required.
  await page.unroute(previewUrl);
  await page.route(previewUrl, async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.executable = false;
    envelope.data.conflict = "Synthetic preview conflict";
    await route.fulfill({ response, json: envelope });
  });
  await open("Full folder");
  await expect(dialog).toContainText("Synthetic preview conflict");
  await expect(archive).toBeDisabled();
  await cancel();

  // Late successful response from a closed dialog cannot replace a newer Page plan.
  await page.unroute(previewUrl);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let received;
  const pending = new Promise((resolve) => { received = resolve; });
  await page.route(previewUrl, async (route) => {
    const response = await route.fetch();
    if (route.request().postDataJSON().type === "archive-folder") {
      received();
      await held;
    } else displayedPlan = (await response.json()).data;
    await route.fulfill({ response });
  });
  await open("Full folder");
  await pending;
  await expect(archive).toBeDisabled();
  await cancel();
  // Expand the Folder to expose the Page row.
  const fullRow = page.getByRole("row").filter({ has: button(page, "Actions for Full folder") });
  if (await fullRow.getAttribute("aria-expanded") === "false") {
    await fullRow.getByRole("button").first().click();
  }
  await open("Sample page");
  await expect(archive).toBeEnabled();
  await expect(dialog).toContainText("_archive/full/sample.yaml");
  const pagePlan = structuredClone(displayedPlan);
  const late = page.waitForResponse((response) =>
    response.url().endsWith("/structure/plan") && response.request().postDataJSON().type === "archive-folder");
  release();
  await late;
  // Waiting for a render turn also detects a late state overwrite.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(dialog).toContainText("_archive/full/sample.yaml");
  assert.equal(pagePlan.affectedPages, 1);

  // Apply conflict invalidates the displayed plan and never silently fetches/applies a new one.
  await page.route(applyUrl, (route) => route.fulfill({
    status: 409, json: { data: null, diagnostics: [{ code: "STRUCTURE_CONFLICT", message: "Synthetic apply conflict" }] }
  }));
  const beforeConflict = previews;
  await archive.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(archive).toBeDisabled();
  assert.deepEqual(sentPlan, pagePlan);
  assert.equal(previews, beforeConflict);
  assert.equal(await readFile(path.join(content, "full/sample.yaml"), "utf8"), pageSource);
  await page.unroute(applyUrl);
  await page.unroute(previewUrl);
  await page.route(previewUrl, capture);
  await review.click();
  await expect(archive).toBeEnabled();
  const refreshed = structuredClone(displayedPlan);
  const beforeApply = previews;
  await archive.click();
  await expect(dialog).toBeHidden();
  assert.equal(previews, beforeApply);
  assert.deepEqual(sentPlan, refreshed);
  assert.equal(await readFile(path.join(content, "_archive/full/sample.yaml"), "utf8"), pageSource);
  await page.reload({ waitUntil: "networkidle" });
  await expect(button(page.getByRole("treegrid"), "Actions for Sample page")).toHaveCount(0);
  console.log("Archive preview: Folder/Page, zero/nonzero impact, plan identity, failure/review, conflicts and stale responses: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
