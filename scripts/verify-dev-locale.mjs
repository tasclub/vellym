import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 4181;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  "packages/vellym/dist/cli.mjs",
  "dev",
  "--config", "how-to-use/vellym.config.yaml",
  "--host", "127.0.0.1",
  "--port", String(port)
], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });

try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (attempt === 99) throw new Error("dev server did not become ready");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const failures = [];
    const pageErrors = [];
    page.on("requestfailed", (request) => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${origin}/pages/overview/`, { waitUntil: "networkidle" });
    const initialPageCount = await page.getByRole("treegrid").getByRole("row").count();
    const localeLabels = await page.locator(".language-switcher a").allTextContents();
    if (JSON.stringify(localeLabels) !== JSON.stringify(["日本語", "English"])) {
      throw new Error(`language labels are not self-names: ${JSON.stringify(localeLabels)}`);
    }
    await page.locator(".language-switcher").getByRole("link", { name: /^(英語|English)$/ }).click();
    await page.waitForURL(`${origin}/en/pages/overview/`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { level: 1, name: "What is Vellym", exact: true }).waitFor();
    const englishPageCount = await page.getByRole("treegrid").getByRole("row").count();
    if (englishPageCount !== initialPageCount) {
      throw new Error(`document count changed by locale: ${initialPageCount} -> ${englishPageCount}`);
    }

    const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
      links.map((link) => link.href)
    );
    for (const stylesheet of stylesheets) {
      const response = await page.request.get(stylesheet);
      if (!response.ok() || !response.headers()["content-type"]?.startsWith("text/css")) {
        throw new Error(`CSS response invalid: ${response.status()} ${response.headers()["content-type"]}`);
      }
    }
    const faviconUrl = await page.locator('link[rel="icon"]').getAttribute("href");
    const favicon = await page.request.get(new URL(faviconUrl, page.url()).href);
    if (!favicon.ok() || !favicon.headers()["content-type"]?.startsWith("image/png")) {
      throw new Error(`favicon response invalid: ${favicon.status()} ${favicon.headers()["content-type"]}`);
    }
    if (failures.length || pageErrors.length) {
      throw new Error(`browser errors: ${JSON.stringify({ failures, pageErrors })}`);
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      url: page.url(),
      heading: await page.getByRole("heading", { level: 1 }).first().textContent(),
      localeLabels,
      pageCount: englishPageCount,
      stylesheets,
      favicon: favicon.status()
    })}\n`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}
