// Run after npm run build: node tests/ticket-detail-reference.browser.mjs
// Reference fields show same-tracker ticket titles, including in static output.
import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "ticket-detail-reference-"));
const content = path.join(root, "content");
const config = path.join(root, "vellym.config.yaml");
const write = async (relative, text) => {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};
const ticket = (name, title, fields = "") => `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata: { name: ${name}, title: "${title}" }
spec:
  status: open
  fields:
${fields || "    {}"}
  blocks:
    - { id: body, type: rich-text, content: "Body" }
`;

await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
await write("vellym.config.yaml", `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui:
  language: ja
i18n:
  defaultLocale: ja
plugins:
  - "@vellym/tickets"
`);
await write("content/tracker.yaml", `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: tracker, title: Tracker }
spec:
  statuses:
    - { id: open, label: Open, category: open }
  fields:
    - { id: parent, label: 親, type: reference }
    - { id: dependsOn, label: 依存, type: reference, multiple: true }
`);
await write("content/+tickets/source.yaml", ticket("source", "参照元", `    parent: parent
    dependsOn: [dependency, missing-ticket-with-a-very-long-name-that-must-wrap-inside-the-detail-column]`));
await write("content/+tickets/parent.yaml", ticket("parent", "親チケットのとても長い題名", ""));
await write("content/+tickets/dependency.yaml", ticket("dependency", "依存先チケット", ""));

const port = 4199;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });
let browser;
let staticServer;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const sourceUrl = `${base}/ja/pages/source/`;
  await page.goto(sourceUrl, { waitUntil: "networkidle" });

  for (const width of [1400, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "親チケットのとても長い題名", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "依存先チケット", exact: true })).toBeVisible();
    await expect(page.getByText("missing-ticket-with-a-very-long-name-that-must-wrap-inside-the-detail-column（見つかりません）")).toBeVisible();
    const overflows = await page.locator(".plugin-detail-field dd").evaluateAll((items) => {
      const right = document.querySelector(".plugin-detail-fields")?.getBoundingClientRect().right ?? 0;
      return items.filter((item) => item.getBoundingClientRect().right > right + 0.5).length;
    });
    expect(overflows, `detail values overflow at ${width}px`).toBe(0);
  }
  await page.getByRole("button", { name: "親チケットのとても長い題名", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/parent\/$/);

  const build = spawnSync(process.execPath, ["packages/vellym/dist/cli.mjs", "build", "--config", config, "--json"], { encoding: "utf8" });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
  const outputDir = JSON.parse(build.stdout).data.outputDir;
  staticServer = createServer(async (request, response) => {
    try {
      let file = path.resolve(outputDir, `.${new URL(request.url ?? "/", "http://127.0.0.1").pathname}`);
      if (file !== outputDir && !file.startsWith(`${outputDir}${path.sep}`)) throw new Error("outside output");
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      response.setHeader("content-type", {
        ".css": "text/css",
        ".html": "text/html",
        ".js": "text/javascript",
        ".json": "application/json"
      }[path.extname(file)] ?? "application/octet-stream");
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const staticPort = staticServer.address().port;
  const staticPage = await context.newPage();
  await staticPage.goto(`http://127.0.0.1:${staticPort}/pages/source/`, { waitUntil: "networkidle" });
  await expect(staticPage.getByRole("button", { name: "親チケットのとても長い題名", exact: true })).toBeVisible();
  await staticPage.getByRole("button", { name: "親チケットのとても長い題名", exact: true }).click();
  await expect(staticPage).toHaveURL(/\/pages\/parent\/$/);
  await context.close();
  console.log("Ticket detail references resolve titles, wrap, and open in dynamic and static views: passed");
} finally {
  await browser?.close();
  if (staticServer?.listening) staticServer.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
