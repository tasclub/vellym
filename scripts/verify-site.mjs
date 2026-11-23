import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../dist/site");
const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"]
]);
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join("; ");

for (const asset of await readdir(path.join(root, "assets"))) {
  if (!asset.endsWith(".js")) continue;
  const source = await readFile(path.join(root, "assets", asset), "utf8");
  if (source.includes("Error compiling schema")) {
    throw new Error(`Ajv runtime compiler is present in browser asset: ${asset}`);
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const decoded = decodeURIComponent(url.pathname);
    // 同じ成果物を任意subdirectoryへ配置した場合を、/manual prefixを剥がして再現する。
    const servedPath = decoded === "/manual" || decoded.startsWith("/manual/")
      ? decoded.slice("/manual".length) || "/"
      : decoded;
    let filename = path.resolve(root, `.${servedPath}`);
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, "index.html");
    response.setHeader("content-security-policy", contentSecurityPolicy);
    response.setHeader("content-type", types.get(path.extname(filename)) ?? "application/octet-stream");
    createReadStream(filename).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

// Static ticket pages (ticket-01m7nyfvg0kehynhatga9962qf). Runs before the guide
// scenarios so a failure there does not hide these checks.
const knownIssues = [];
async function verifyStaticTickets(browser, baseUrl) {
  const demoDir = path.resolve(import.meta.dirname, "../how-to-use/content/demo-tickets/+tickets");
  if (!existsSync(demoDir)) return;
  const names = [];
  for (const file of (await readdir(demoDir)).filter((name) => name.endsWith(".yaml")).sort()) {
    const match = (await readFile(path.join(demoDir, file), "utf8")).match(/^\s*name:\s*(\S+)\s*$/m);
    if (!match) throw new Error(`demo Ticket ${file} has no metadata.name`);
    names.push(match[1]);
  }
  if (!names.length) throw new Error("no demo Tickets found");
  const buildIds = (await readdir(path.join(root, "data"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (buildIds.length !== 1) throw new Error(`expected one build data folder, found ${buildIds.length}`);
  for (const name of names) {
    for (const prefix of ["", "en/"]) {
      if (!existsSync(path.join(root, `${prefix}pages/${name}/index.html`))) {
        throw new Error(`static Ticket page is missing: ${prefix}pages/${name}/`);
      }
    }
    for (const language of ["ja", "en"]) {
      const file = path.join(root, "data", buildIds[0], language, "pages", `${name}.json`);
      if (!existsSync(file)) throw new Error(`static Ticket data is missing: ${language}/${name}`);
      const json = JSON.parse(await readFile(file, "utf8"));
      if (json?.data?.page?.metadata?.name !== name) throw new Error(`static Ticket data has the wrong name: ${language}/${name}`);
    }
  }

  // The UI language follows the site config, not the page language, so match both.
  const viewNames = [/^(チケット一覧|Ticket list)$/, /^(カンバン|Kanban)$/, /^WBS$/];
  const languages = [
    { language: "ja", prefix: "", locale: "ja-JP" },
    { language: "en", prefix: "/en", locale: "en-US" }
  ];
  const forbiddenButtons = /このチケット管理の設定|Tracker settings|チケットを作成|New ticket|アーカイブ|Archive|一括|Bulk/;
  const countForbidden = async (page, where) => {
    const buttons = await page.getByRole("button", { name: forbiddenButtons }).count();
    const selection = await page.getByRole("checkbox", { name: /選択|Select/ }).count();
    if (buttons || selection) {
      throw new Error(`static ${where} exposes unavailable operations (buttons ${buttons}, row selection ${selection})`);
    }
  };
  for (const scenario of languages) {
    const context = await browser.newContext({ locale: scenario.locale, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const listUrl = `${baseUrl}${scenario.prefix}/pages/demo-tickets/`;
    const response = await page.goto(listUrl, { waitUntil: "networkidle" });
    if (!response?.ok()) throw new Error(`${listUrl} returned ${response?.status()}`);
    for (const view of viewNames) {
      await page.getByRole("button", { name: view }).click();
      await page.waitForLoadState("networkidle");
      await countForbidden(page, `${scenario.language} ${view}`);
    }
    await page.getByRole("button", { name: viewNames[0] }).click();
    const filter = page.getByRole("button", { name: /^(絞り込み|Filters?)/ });
    if (!(await filter.isEnabled())) throw new Error(`${scenario.language} static Ticket list filter is not usable`);
    const sortHeader = page.locator("table thead").getByRole("button").first();
    if (!(await sortHeader.isEnabled())) throw new Error(`${scenario.language} static Ticket list sorting is not usable`);
    const firstRow = page.locator("table tbody tr").first().getByRole("button").first();
    const title = (await firstRow.innerText()).trim();
    await firstRow.click();
    await page.waitForURL(/\/pages\/ticket-[0-9a-z]+\/$/);
    const heading = page.getByRole("heading", { level: 1, name: title, exact: true });
    await heading.waitFor();
    await countForbidden(page, `${scenario.language} Ticket detail`);
    const reloaded = await page.reload({ waitUntil: "networkidle" });
    if (!reloaded?.ok()) throw new Error(`${scenario.language} Ticket detail reload returned ${reloaded?.status()}`);
    await heading.waitFor();
    if (errors.length) throw new Error(`${scenario.language} static Ticket browser errors: ${errors.join("; ")}`);
    await context.close();
  }

  // The static detail of a parent lists the tickets that point at it (ticket-01m7k6gftq6gt6j226dsbz5yq0).
  {
    const context = await browser.newContext({ locale: "ja-JP", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/pages/ticket-01m0m000000000000000000005/`, { waitUntil: "networkidle" });
    const referenced = page.locator('section[aria-labelledby="plugin-referenced-by"]');
    await referenced.waitFor();
    if (await referenced.getByRole("listitem").count() !== 3) throw new Error("static Ticket detail does not list its 3 children as referencing it");
    // Related commits are live-only (ticket-01m6sy034fzn60bv6ayw7sbg2n).
    if (await page.locator('section[aria-labelledby="plugin-related-commits"]').count()) throw new Error("static Ticket detail shows related commits");
    await context.close();
  }
  const failing = await browser.newContext({ locale: "ja-JP", viewport: { width: 1440, height: 900 } });
  const failingPage = await failing.newPage();
  await failingPage.route(`**/data/*/ja/pages/${names[0]}.json`, (route) => route.fulfill({ status: 404, body: "Not found" }));
  await failingPage.goto(`${baseUrl}/pages/${names[0]}/`, { waitUntil: "networkidle" });
  const alert = failingPage.getByRole("alert");
  try {
    await alert.first().waitFor({ timeout: 5000 });
  } catch {
    throw new Error("static Ticket detail shows no error when its data fails to load");
  }
  await failing.close();
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("site server did not start");
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
try {
  await verifyStaticTickets(browser, baseUrl);
  for (const issue of knownIssues) process.stdout.write(`known issue: ${issue}\n`);
  process.stdout.write("static Ticket verification passed\n");
  for (const scenario of [
    { path: "/", language: "ja", heading: "Vellymとは", width: 1440 },
    { path: "/en/", language: "en", heading: "What is Vellym", width: 390 },
    { path: "/manual/pages/overview/", language: "ja", heading: "Vellymとは", width: 390 },
    { path: "/manual/en/pages/overview/", language: "en", heading: "What is Vellym", width: 1440 }
  ]) {
    const context = await browser.newContext({
      locale: scenario.language === "ja" ? "ja-JP" : "en-US",
      viewport: { width: scenario.width, height: 844 }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const response = await page.goto(`${baseUrl}${scenario.path}`, { waitUntil: "networkidle" });
    if (!response?.ok()) throw new Error(`${scenario.path} returned ${response?.status()}`);
    if ((await page.locator("html").getAttribute("lang")) !== scenario.language) {
      throw new Error(`${scenario.path} has the wrong document language`);
    }
    if ((await page.getByRole("heading", { level: 1, name: scenario.heading }).count()) !== 1) {
      throw new Error(`${scenario.path} has no unique Vellym heading`);
    }
    // The site UI is Japanese: on English pages the chrome says so with its own lang,
    // overlays included; on Japanese pages no extra lang is needed (ticket-01m7f500000000000000000001).
    const railLang = await page.locator("aside").first().getAttribute("lang");
    if (railLang !== (scenario.language === "en" ? "ja" : null)) {
      throw new Error(`${scenario.path} product rail has lang=${railLang}`);
    }
    if (scenario.language === "en" && scenario.width < 768) {
      // The navigation drawer is portaled into document.body, outside the chrome.
      await page.getByRole("button", { name: /^(文書ナビゲーションを開く|Open document navigation)$/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const dialogLang = await dialog.evaluate((element) => element.closest("[lang]")?.getAttribute("lang"));
      if (dialogLang !== "ja") throw new Error(`${scenario.path} search dialog has lang=${dialogLang}`);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    }
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    if (axe.violations.length) {
      throw new Error(`${scenario.path} accessibility violations: ${axe.violations.map((item) => item.id).join(", ")}`);
    }
    if (errors.length) throw new Error(`${scenario.path} browser errors: ${errors.join("; ")}`);
    await context.close();
  }
  // The published guide may not contain TicketTracker fixtures. Always verify
  // plugin styles load from the real static bootstrap; exercise the board too
  // when the site has a suitable fixture page.
  const kanbanContext = await browser.newContext({
    locale: "ja-JP",
    viewport: { width: 390, height: 844 }
  });
  const kanbanPage = await kanbanContext.newPage();
  const kanbanErrors = [];
  kanbanPage.on("pageerror", (error) => kanbanErrors.push(error.message));
  kanbanPage.on("console", (message) => {
    if (message.type() === "error") kanbanErrors.push(message.text());
  });
  const guideResponse = await kanbanPage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  if (!guideResponse?.ok()) throw new Error("static guide did not load for plugin stylesheet verification");
  await kanbanPage.locator('link[data-vellym-plugin-style="kanban"]')
    .waitFor({ state: "attached" });
  await kanbanPage.locator('link[data-vellym-plugin-style="tickets"]')
    .waitFor({ state: "attached" });
  if (existsSync(path.join(root, "pages/demo-tickets/index.html"))) {
    const kanbanResponse = await kanbanPage.goto(`${baseUrl}/pages/demo-tickets/`, {
      waitUntil: "networkidle"
    });
    if (!kanbanResponse?.ok()) throw new Error("static demo Ticket page did not load");
    await kanbanPage.getByRole("button", { name: "カンバン" }).click();
    const board = kanbanPage.getByRole("region", { name: "チケットのカンバン" });
    await board.waitFor();
    if (await board.locator("article[data-ticket-name]").count() === 0) {
      throw new Error("static Kanban has no visible cards");
    }
    if (await board.getByRole("button", { name: /上へ|下へ|Move up|Move down/ }).count()) {
      throw new Error("static Kanban exposes ordering controls");
    }
    if (await board.locator('[draggable="true"]').count()) {
      throw new Error("static Kanban exposes draggable cards");
    }
    if (await board.getByRole("alert").count()) {
      throw new Error("static Kanban exposes a definition diagnostic");
    }
    const columns = board.locator('input[type="checkbox"]');
    if (await columns.count() < 2) throw new Error("static Kanban has no column preferences");
    await board.locator("details > summary").click();
    const initialColumns = await columns.evaluateAll((items) => items.map((item) => (item).checked));
    await columns.nth(1).uncheck();
    await kanbanPage.reload({ waitUntil: "networkidle" });
    await kanbanPage.getByRole("button", { name: "カンバン" }).click();
    const restoredBoard = kanbanPage.getByRole("region", { name: "チケットのカンバン" });
    await restoredBoard.waitFor();
    await restoredBoard.locator("details > summary").click();
    const persistedColumns = await restoredBoard.locator('input[type="checkbox"]')
      .evaluateAll((items) => items.map((item) => (item).checked));
    if (persistedColumns[1] !== false || initialColumns[1] !== true) {
      throw new Error("static Kanban did not persist its column selection");
    }
  }
  if (kanbanErrors.length) throw new Error(`static Kanban browser errors: ${kanbanErrors.join("; ")}`);
  await kanbanContext.close();
  const response = await fetch(`${baseUrl}/`);
  if (!response.ok || !(await response.text()).includes("Vellym")) {
    throw new Error("Japanese guide is not served");
  }
  const privateProjectDocs = await fetch(`${baseUrl}/project/`);
  if (privateProjectDocs.status !== 404) {
    throw new Error("maintainer project documents must not be published");
  }
  const texts = [];
  for (const file of ["/llms.txt", "/llms-full.txt", "/en/llms-full.txt"]) {
    const response = await fetch(`${baseUrl}${file}`);
    if (!response.ok) throw new Error(`${file} is not served`);
    texts.push(await response.text());
  }
  const [index, ja, en] = texts;
  const sections = ["## 日本語の利用ガイド", "## English user guide", "## Full text", "## Schemas"];
  if (!index.startsWith("# Vellym\n> ") || sections.some((section, i) => !index.includes(section) || (i && index.indexOf(section) < index.indexOf(sections[i - 1]))) ||
      !index.includes("https://vellym.tasclub.com/llms-full.txt") || !index.includes("https://vellym.tasclub.com/en/llms-full.txt")) {
    throw new Error("llms.txt has an invalid index");
  }
  for (const name of await readdir(path.join(root, "schemas/v1"))) {
    if (name.endsWith(".schema.json") && !index.includes(`https://vellym.tasclub.com/schemas/v1/${name}`)) {
      throw new Error(`llms.txt is missing schema ${name}`);
    }
  }
  if (!index.includes("https://vellym.tasclub.com/schemas/config-v1.schema.json")) throw new Error("llms.txt is missing config schema");
  if (!ja.startsWith("# Vellym 利用ガイド（全文）") || !en.startsWith("# Vellym User Guide (full text)") ||
      !ja.includes("1. [") || !en.includes("1. [") || !ja.includes("Source: https://") || !en.includes("Source: https://") ||
      !ja.includes("Vellymとは") || !ja.includes("ドキュメントの正本をGitで管理") ||
      !ja.includes("下書き（`visibility: draft`）の翻訳だけが参照する画像") ||
      ja.includes("What is Vellym") || !en.includes("What is Vellym") || en.includes("Vellymとは")) {
    throw new Error("llms full texts are missing content or mix languages");
  }
  const build = JSON.parse(await readFile(path.join(root, "vellym-build.json"), "utf8"));
  for (const locale of ["ja", "en"]) {
    const repository = JSON.parse(await readFile(path.join(root, "data", build.buildId, locale, "repository.json"), "utf8"));
    const demo = repository.data.pages.filter((page) => page.relativePath.startsWith("demo-tickets/"));
    for (const text of texts) {
      if (demo.some((page) => text.includes(page.title)) || text.includes("/pages/ticket-01m0m")) throw new Error("llms contains a demo page");
    }
    // Code examples are intentionally literal; only prose links should expand.
    let fenced = null;
    for (const line of (locale === "ja" ? ja : en).split("\n")) {
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fenced) { if (fence && fence[1][0] === fenced[0] && fence[1].length >= fenced.length && !fence[2].trim()) fenced = null; continue; }
      if (fence) { fenced = fence[1]; continue; }
      const prose = line.replace(/(`+).*?\1/g, "");
      for (const page of repository.data.pages) {
        if (prose.includes(`[[${page.name}]]`) || prose.includes(`[[${page.name}|`)) throw new Error(`unexpanded internal link: ${page.name}`);
      }
    }
  }
  for (const version of ["v1alpha1", "v1"]) {
    for (const resource of ["page", "folder", "rich-text-block"]) {
      const response = await fetch(`${baseUrl}/schemas/${version}/${resource}.schema.json`);
      if (!response.ok) throw new Error(`${version} ${resource} schema is not served`);
      JSON.parse(await response.text());
    }
  }
  for (const resource of ["ticket", "ticket-tracker"]) {
    const response = await fetch(`${baseUrl}/schemas/v1/${resource}.schema.json`);
    if (!response.ok) throw new Error(`${resource} schema is not served`);
    const schema = JSON.parse(await response.text());
    if (schema.$id !== `https://vellym.tasclub.com/schemas/v1/${resource}.schema.json`) {
      throw new Error(`${resource} schema has the wrong $id`);
    }
  }
  const configSchema = await fetch(`${baseUrl}/schemas/config-v1.schema.json`);
  if (!configSchema.ok) throw new Error("config schema is not served");
  JSON.parse(await configSchema.text());
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
process.stdout.write("official site browser verification passed\n");
