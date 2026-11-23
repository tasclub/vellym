// Run after npm run build: node tests/static-assets.browser.mjs
// Static output shows images referenced by published bodies, also under a subdirectory
// (ticket-01m748wq4ddar0gdyytdxn95vy).
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { staticAssetsProject } from "./static-assets-fixture.mjs";

const project = await staticAssetsProject();
const build = spawnSync(process.execPath, ["packages/vellym/dist/cli.mjs", "build", "--config", project.config, "--json"], { encoding: "utf8" });
if (build.status !== 0) throw new Error(build.stdout + build.stderr);
const output = JSON.parse(build.stdout).data.outputDir;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = createServer(async (request, response) => {
  try {
    const decoded = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    // Serve the same output under /manual/ to reproduce a subdirectory deployment.
    if (decoded !== "/manual" && !decoded.startsWith("/manual/")) { response.writeHead(404).end(); return; }
    let file = path.resolve(output, `.${decoded.slice("/manual".length) || "/"}`);
    if (file !== output && !file.startsWith(`${output}${path.sep}`)) { response.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    response.setHeader("content-type", types[path.extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const shown = (name) => page.getByRole("img", { name, exact: true })
    .evaluate((img) => img.complete && img.naturalWidth > 0);
  await page.goto(`http://127.0.0.1:${port}/manual/pages/page/`, { waitUntil: "networkidle" });
  const image = page.getByRole("img", { name: "図", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => shown("図")).toBe(true);
  const src = await image.getAttribute("src");
  if (!src?.includes("/manual/media/images/used.png")) throw new Error(`unexpected image URL: ${src}`);
  // Opening the page again after the site root must resolve the image against the same base.
  await page.goto(`http://127.0.0.1:${port}/manual/`, { waitUntil: "networkidle" });
  await page.goto(`http://127.0.0.1:${port}/manual/pages/page/`, { waitUntil: "networkidle" });
  await expect.poll(() => shown("図")).toBe(true);
  if (errors.length) throw new Error(errors.join("; "));
  console.log("Static images: copied to media/, shown under /manual/ subdirectory: passed");
} finally {
  await browser.close();
  server.close();
  await rm(project.root, { recursive: true, force: true });
}
