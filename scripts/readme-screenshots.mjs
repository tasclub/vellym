// npm run readme:screenshots — retake the README images from the public guide's static output
// (ticket-01m6sy03482dah0pzpqvmgx7b5). Only the how-to-use demo is photographed, so no user
// documents or local network details can appear. Each file must stay at or below 300 KB.
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../dist/site");
const out = path.resolve(import.meta.dirname, "../.github/readme");
const limit = 300 * 1024;
const types = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".txt": "text/plain" };

const server = createServer(async (request, response) => {
  try {
    let file = path.resolve(root, `.${decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname)}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    response.setHeader("content-type", types[path.extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(out, { recursive: true });

const shots = [
  { file: "document.png", url: "/pages/overview/" },
  { file: "ticket-list.png", url: "/pages/demo-tickets/", view: "チケット一覧" },
  { file: "kanban.png", url: "/pages/demo-tickets/", view: "カンバン" },
  { file: "wbs.png", url: "/pages/demo-tickets/", view: "WBS" }
];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: "ja-JP" });
  for (const shot of shots) {
    const page = await context.newPage();
    await page.goto(`${base}${shot.url}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    if (shot.view) {
      await page.getByRole("button", { name: shot.view, exact: true }).click();
      await page.waitForLoadState("networkidle");
      if (shot.view === "WBS") await page.locator(".wbs-row[data-ticket-name] .wbs-left").first().waitFor();
    }
    await page.waitForTimeout(300);
    const target = path.join(out, shot.file);
    await page.screenshot({ path: target });
    const { size } = await stat(target);
    if (size > limit) throw new Error(`${shot.file} is ${size} bytes, over the 300 KB limit`);
    console.log(`${shot.file}: ${Math.round(size / 1024)} KB`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
