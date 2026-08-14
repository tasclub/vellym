import { createReadStream } from "node:fs";
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
  const response = await fetch(`${baseUrl}/`);
  if (!response.ok || !(await response.text()).includes("Vellym")) {
    throw new Error("Japanese guide is not served");
  }
  const privateProjectDocs = await fetch(`${baseUrl}/project/`);
  if (privateProjectDocs.status !== 404) {
    throw new Error("maintainer project documents must not be published");
  }
  for (const version of ["v1alpha1", "v1"]) {
    for (const resource of ["page", "folder", "rich-text-block"]) {
      const response = await fetch(`${baseUrl}/schemas/${version}/${resource}.schema.json`);
      if (!response.ok) throw new Error(`${version} ${resource} schema is not served`);
      JSON.parse(await response.text());
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
