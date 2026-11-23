// Run after npm run build: node tests/watch-keeps-focus.browser.mjs
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "vellym-watch-focus-"));
const content = path.join(root, "content");
await mkdir(content, { recursive: true });
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
const config = path.join(root, "vellym.config.yaml");
await writeFile(
  config,
  'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins:\n  - "@vellym/tickets"\n'
);

const pageYaml = (name, title, body) => `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: ${name}
  title: ${title}
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: ${JSON.stringify(body)}
`;
const guideFile = path.join(content, "guide.yaml");
const otherFile = path.join(content, "other.yaml");
const originalGuide = pageYaml("guide", "Editor test", "");
await writeFile(guideFile, originalGuide);
await writeFile(otherFile, pageYaml("other", "Other page", "Original other content"));
const longBody = [
  "## Reading anchor",
  ...Array.from(
    { length: 60 },
    (_, index) => `Paragraph ${index + 1}: This long document keeps enough content below the fold.`
  )
].join("\n\n");
await writeFile(path.join(content, "reading.yaml"), pageYaml("reading", "Reading test", longBody));

const port = 4211;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  "packages/vellym/dist/cli.mjs",
  "dev",
  "--config",
  config,
  "--port",
  String(port)
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/en/pages/guide/`, { waitUntil: "networkidle" });
  const editor = page.locator('[contenteditable="true"]').first();
  const isRepositoryRequest = (request) =>
    new URL(request.url()).pathname === "/api/v1/repository";
  const isRepositoryResponse = (response) =>
    new URL(response.url()).pathname === "/api/v1/repository";
  const writeAndWaitForRefresh = async (file, data, pageName) => {
    const request = page.waitForRequest(isRepositoryRequest, { timeout: 15000 });
    const response = page.waitForResponse(isRepositoryResponse, { timeout: 15000 });
    const pageResponse = pageName
      ? page.waitForResponse(
          (candidate) =>
            new URL(candidate.url()).pathname === `/api/v1/pages/${pageName}`,
          { timeout: 15000 }
        )
      : undefined;
    await writeFile(file, data);
    await request;
    const repositoryResponse = await response;
    expect(repositoryResponse.ok()).toBe(true);
    await repositoryResponse.finished();
    if (pageResponse) {
      const refreshedPage = await pageResponse;
      expect(refreshedPage.ok()).toBe(true);
      await refreshedPage.finished();
    }
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
  };
  const editorHasFocus = () =>
    editor.evaluate((node) => node.contains(document.activeElement));

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor.click();
  await page.keyboard.type("abc");
  await expect(editor).toContainText("abc");

  // Rewriting the same bytes still produces a repository-change notification.
  await writeAndWaitForRefresh(guideFile, originalGuide);
  await expect.poll(editorHasFocus).toBe(true);
  // A change to another page must not steal focus from the active editor either.
  await writeAndWaitForRefresh(
    otherFile,
    pageYaml("other", "Other page", "Changed other-page content")
  );
  await expect.poll(editorHasFocus).toBe(true);
  await page.keyboard.type("def");
  await expect(editor).toContainText("abcdef");
  await expect.poll(editorHasFocus).toBe(true);

  await page.goto(`${base}/en/pages/reading/`, { waitUntil: "networkidle" });
  const main = page.locator("#document-content");
  const anchor = page.getByRole("heading", { name: "Reading anchor", exact: true });
  await expect(anchor).toBeVisible();
  const editButton = page.getByRole("button", { name: "Edit", exact: true });
  await editButton.focus();
  await expect(editButton).toBeFocused();
  const scrollTop = await main.evaluate((node) => {
    node.scrollTo({ top: 400 });
    return node.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);

  await writeAndWaitForRefresh(
    otherFile,
    pageYaml("other", "Other page", "Changed other-page content again"),
    "reading"
  );
  await expect.poll(() => main.evaluate((node) => node.scrollTop)).toBe(scrollTop);
  await expect(editButton).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("MAIN");
  console.log("Repository watch preserves editor focus and reading position: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
