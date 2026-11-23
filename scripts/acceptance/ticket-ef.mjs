// Ticket management manual acceptance, sections E (static output) and F (scale).
// ticket-01m7p97tp8htrtkdv8z2dxs6xq.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { project, TICKETS, TRACKER } from "./ticket-d.mjs";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
/** Serves a static build over HTTP, also under /sub/ to reproduce a subpath deployment. */
async function serve(ctx, root) {
  const server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
      if (pathname === "/sub" || pathname.startsWith("/sub/")) pathname = pathname.slice(4) || "/";
      let file = ctx.path.resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(`${root}${ctx.path.sep}`)) { response.writeHead(403).end(); return; }
      if ((await ctx.fs.stat(file)).isDirectory()) file = ctx.path.join(file, "index.html");
      response.setHeader("content-type", types[ctx.path.extname(file)] ?? "application/octet-stream");
      createReadStream(file).pipe(response);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
const forbidden = /チケットを作成|このチケット管理の設定|アーカイブ|一括|^編集$|^保存$/;

const rss = async (ctx, pid) => {
  const status = await ctx.fs.readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
  const match = status.match(/^VmRSS:\s+(\d+) kB/m);
  return match ? Math.round(Number(match[1]) / 1024) : undefined;
};
const freePort = () => new Promise((resolve) => {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

export const steps = [
  { id: "TICKET-MANUAL-E01", title: "プラグイン有効での静的出力", async run(ctx) {
    const root = await project(ctx, ["@vellym/tickets", "@vellym/kanban"]);
    const build = spawnSync(process.execPath, [ctx.path.join(ctx.repository, "packages/vellym/dist/cli.mjs"), "build", "--json", "--config", ctx.path.join(root, "vellym.config.yaml")], { cwd: root, encoding: "utf8", timeout: 120_000 });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const output = JSON.parse(build.stdout).data.outputDir;
    const http = await serve(ctx, output);
    try {
      for (const prefix of ["", "/sub"]) {
        const label = prefix ? "サブpath" : "ルート";
        const page = await ctx.page(http.origin);
        ctx.state.page = page;
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${http.origin}${prefix}/pages/${TRACKER}/`, { waitUntil: "networkidle" });
        await ctx.check(`${label}: HTTPで配れば一覧が閲覧でき、絞り込みと並べ替えが動く`, async () => {
          await page.getByRole("button", { name: "チケット一覧", exact: true }).click();
          const table = page.getByRole("table").first();
          await ctx.expect(table).toContainText("通知を見直す");
          await page.getByRole("button", { name: /^絞り込み/ }).click();
          await ctx.expect(page.getByRole("dialog").or(page.locator("[role=group]")).first()).toBeVisible();
          await page.keyboard.press("Escape");
          await table.locator("thead").getByRole("button").first().click();
          await ctx.expect(table).toBeVisible();
        });
        await ctx.check(`${label}: 作成・編集・保存・アーカイブ・定義編集・一括編集が現れない`, async () => {
          for (const view of ["チケット一覧", "カンバン"]) {
            await page.getByRole("button", { name: view, exact: true }).click();
            await page.waitForLoadState("networkidle");
            const names = await page.getByRole("button").evaluateAll((buttons) => buttons.map((button) => (button.getAttribute("aria-label") || button.textContent || "").trim()));
            assert.deepEqual(names.filter((name) => forbidden.test(name)), [], `${view}: ${names.join(", ")}`);
            assert.equal(await page.getByRole("checkbox", { name: /選択/ }).count(), 0);
          }
        });
        await ctx.check(`${label}: プラグインが自分で描く画面（カンバン）が静的出力でも出る`, async () => {
          await page.getByRole("button", { name: "カンバン", exact: true }).click();
          const board = page.getByRole("region", { name: /カンバン/ });
          await ctx.expect(board).toBeVisible();
          // isStatic reaches the plugin: no drag handles on cards (the document tree may still drag).
          await ctx.expect(board.locator('[draggable="true"]')).toHaveCount(0);
        });
        await ctx.check(`${label}: 詳細が閲覧できる`, async () => {
          await page.goto(`${http.origin}${prefix}/pages/${TICKETS[0]}/`, { waitUntil: "networkidle" });
          await ctx.expect(page.getByRole("heading", { level: 1, name: "通知を見直す" })).toBeVisible();
          await ctx.expect(page.getByRole("button", { name: "編集", exact: true })).toHaveCount(0);
        });
        await ctx.check(`${label}: ブラウザのエラーが無い`, async () => assert.deepEqual(errors, []));
        await page.context().close();
      }
    } finally { await http.close(); }
    ctx.note("file://で開けないことは仕様（シナリオの注記どおり）。HTTPとサブpathで確かめた。");
  } },

  { id: "TICKET-MANUAL-F01", title: "2万件のチケット（合否なし・実測）", async run(ctx) {
    const root = await ctx.temporary("ticket-f01");
    const fixture = spawnSync(process.execPath, [ctx.path.join(ctx.repository, "scripts/bench-fixture.mjs"), "--out", root, "--tickets", "20000"], { cwd: ctx.repository, encoding: "utf8", timeout: 300_000 });
    if (fixture.status !== 0) ctx.blocked(`fixtureを作れない: ${fixture.stderr.slice(0, 300)}`);
    for (let i = 0; i < 1000; i++) {
      await ctx.write(root, `content/docs/page-${String(i).padStart(4, "0")}.yaml`, `apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata: { name: page-${i}, title: "文書 ${i}" }\nspec:\n  locale: ja\n  blocks:\n    - { id: body, type: rich-text, content: "規模の確認のための本文 ${i}" }\n`);
    }
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const started = performance.now();
    const server = spawn(process.execPath, [ctx.path.join(ctx.repository, "packages/vellym/dist/cli.mjs"), "dev", "--config", ctx.path.join(root, "vellym.config.yaml"), "--host", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    server.stdout.on("data", (chunk) => { log += chunk; });
    server.stderr.on("data", (chunk) => { log += chunk; });
    const measured = {};
    let stopped;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await fetch(`${origin}/api/v1/bootstrap`);
          if (response.ok && (await response.json()).data.state === "ready") break;
        } catch {}
        if (attempt > 1200 || server.exitCode !== null) ctx.blocked(`起動しない: ${log.slice(-300)}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      measured.startupMs = Math.round(performance.now() - started);
      measured.rssAtStartMb = await rss(ctx, server.pid);
      const page = await ctx.page(origin);
      ctx.state.page = page;
      page.setDefaultTimeout(60_000);
      let t = performance.now();
      await page.goto(`${origin}/ja/pages/bench-tracker/`);
      await page.getByRole("button", { name: "チケット一覧", exact: true }).click();
      await page.getByRole("table").first().locator("tbody tr").first().waitFor();
      measured.listFirstMs = Math.round(performance.now() - t);
      t = performance.now();
      await page.getByRole("button", { name: /^未完了のみ|^完了を含める/ }).first().click();
      await page.waitForLoadState("networkidle");
      await page.getByRole("table").first().locator("tbody tr").first().waitFor();
      measured.filterMs = Math.round(performance.now() - t);
      t = performance.now();
      await page.getByRole("table").first().locator("thead").getByRole("button").first().click();
      await page.getByRole("table").first().locator("tbody tr").first().waitFor();
      measured.sortMs = Math.round(performance.now() - t);
      t = performance.now();
      const search = await fetch(`${origin}/api/v1/search?q=${encodeURIComponent("Benchmark ticket 12345")}`);
      await search.json();
      measured.searchMs = Math.round(performance.now() - t);
      await page.goto(`${origin}/ja/pages/bench-ticket-0001/`);
      await page.getByRole("button", { name: "編集", exact: true }).click();
      const editor = page.locator('[contenteditable="true"]').first();
      await editor.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" 規模の確認");
      await page.waitForTimeout(400);
      t = performance.now();
      await page.getByRole("button", { name: "保存", exact: true }).first().click();
      await page.getByRole("button", { name: "編集", exact: true }).waitFor();
      measured.saveMs = Math.round(performance.now() - t);
      assert.match(await ctx.fs.readFile(ctx.path.join(root, "content/+tickets/bench-ticket-0001.yaml"), "utf8"), /規模の確認/);
      measured.rssAfterMb = await rss(ctx, server.pid);
    } catch (error) {
      // No pass/fail here: a step that cannot be measured makes the scenario BLOCKED, and the
      // values measured so far are still recorded (a crashed tab is itself a finding).
      stopped = error.message.split("\n")[0];
      measured.rssAtStopMb = await rss(ctx, server.pid);
    } finally {
      server.kill("SIGTERM");
    }
    measured.tickets = 20000;
    measured.pages = 1000;
    await ctx.fs.writeFile(ctx.path.join(ctx.output, "ticket-f01-measurements.json"), `${JSON.stringify(measured, null, 2)}\n`);
    ctx.note(`実測（合否なし）: ${JSON.stringify(measured)}`);
    if (stopped) return { status: "BLOCKED", detail: `途中で測れなくなった: ${stopped}` };
    return { status: "PASS", detail: "このシナリオは合否を持たない。実測できたのでPASS（測れなければBLOCKED）。" };
  } }
];
