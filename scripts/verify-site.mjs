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

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("site server did not start");
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
try {
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
  const llms = await fetch(`${baseUrl}/llms.txt`);
  const llmsText = await llms.text();
  if (!llms.ok || !llmsText.includes("Vellymとは") || !llmsText.includes("ドキュメントの正本をGitで管理")) {
    throw new Error("llms.txt is missing a known page title or body");
  }
  if (llmsText.includes("[[developing-plugins|")) {
    throw new Error("llms.txt leaves internal link notation unexpanded");
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
