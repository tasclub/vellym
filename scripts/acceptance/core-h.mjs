import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { stringify } from "yaml";

async function serve(ctx, root) {
  const server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/sub" || pathname.startsWith("/sub/")) pathname = pathname.slice(4) || "/";
      let file = ctx.path.resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(`${root}${ctx.path.sep}`)) return response.writeHead(403).end();
      if ((await ctx.fs.stat(file)).isDirectory()) file = ctx.path.join(file, "index.html");
      response.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" })[ctx.path.extname(file)] ?? "application/octet-stream");
      createReadStream(file).pipe(response);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

export const steps = [{
  id: "CORE-MANUAL-A17", title: "静的コンテンツ版を生成して閲覧する",
  async run(ctx) {
    const root = await ctx.temporary("core-static");
    await ctx.write(root, "vellym.config.yaml", stringify({ schemaVersion: "1.0", contentRoot: "content", outputDir: "dist/vellym", ui: { language: "ja" }, plugins: [] }));
    const writePage = async (file, name, title, content, extra = []) => ctx.write(root, `content/${file}`, stringify({
      apiVersion: "vellym.tasclub.com/v1", kind: "Page", metadata: { name, title },
      spec: { locale: "ja", blocks: [{ id: "body", type: "rich-text", format: "commonmark", content }, ...extra] }
    }));
    await writePage("manual/source.yaml", "static-source", "静的リンク元", "## 静的見出し\n\n本文 [[static-target]] と [[static-missing]]\n");
    await writePage("manual/target.yaml", "static-target", "静的リンク先", "## 遷移先見出し\n\n遷移先本文\n");
    await writePage("manual/unsupported.yaml", "static-unsupported", "未対応block保持確認", "## 表示できる本文\n\nこの本文は閲覧できる。\n", [{ id: "future", type: "future-widget", value: "keep-this-exact-value" }]);
    await writePage("_archive/archived.yaml", "static-archived", "アーカイブ文書", "非表示\n");
    const build = spawnSync(process.execPath, [ctx.path.join(ctx.repository, "packages/vellym/dist/cli.mjs"), "build", "--json", "--config", ctx.path.join(root, "vellym.config.yaml")], { cwd: root, encoding: "utf8", timeout: 120000 });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const output = JSON.parse(build.stdout).data.outputDir;
    await ctx.check("日時付き出力とREADMEのHTTP起動コマンド", async () => {
      assert.match(ctx.path.basename(output), /^\d{8}-\d{6}-vellym$/);
      assert.match(await ctx.fs.readFile(ctx.path.join(output, "README.md"), "utf8"), /python3 -m http\.server/);
      await ctx.fs.access(ctx.path.join(output, "index.html"));
    });
    await ctx.check("通常Pageが生成されアーカイブPageは生成されない", async () => {
      for (const name of ["static-source", "static-target", "static-unsupported"]) await ctx.fs.access(ctx.path.join(output, "pages", name, "index.html"));
      await assert.rejects(ctx.fs.access(ctx.path.join(output, "pages", "static-archived", "index.html")));
    });
    const http = await serve(ctx, output);
    try {
      for (const prefix of ["", "/sub"]) {
        const page = await ctx.page(http.origin);
        const failures = [], loaded = [];
        page.on("pageerror", error => failures.push(error.message));
        page.on("response", response => {
          if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
          else loaded.push(new URL(response.url()).pathname);
        });
        for (const width of [1280, 375]) {
          await page.setViewportSize({ width, height: 812 });
          await page.goto(`${http.origin}${prefix}/pages/static-source/`, { waitUntil: "networkidle" });
          const label = `${prefix || "root"} ${width}px`;
          await ctx.check(`${label}: 本文と見出しを閲覧できる`, async () => {
            await ctx.expect(page.getByRole("heading", { name: "静的リンク元", level: 1 })).toBeVisible();
            await ctx.expect(page.getByRole("heading", { name: "静的見出し" })).toBeVisible();
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
          });
          await ctx.check(`${label}: 解決可能な内部リンクとリンク切れ`, async () => {
            await ctx.expect(page.locator(".broken-link").filter({ hasText: "static-missing" })).toBeVisible();
            await page.getByRole("link", { name: /静的リンク先|static-target/ }).first().click();
            await ctx.expect(page.getByRole("heading", { name: "静的リンク先", level: 1 })).toBeVisible();
            assert.match(page.url(), /pages\/static-target\//);
          });
          await ctx.check(`${label}: 逆参照を表示`, async () => {
            await ctx.expect(page.getByText("このPageを参照しているPage")).toBeVisible();
            await ctx.expect(page.getByText("静的リンク元").last()).toBeVisible();
          });
          await ctx.check(`${label}: 編集・管理・設定・検索UIがない`, async () => {
            for (const name of ["編集", "新規作成", "構成管理", "設定", "全文検索を開く"]) await ctx.expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
            await ctx.expect(page.getByRole("searchbox")).toHaveCount(0);
          });
          await ctx.check(`${label}: 未対応blockのあるPageの既知本文`, async () => {
            await page.goto(`${http.origin}${prefix}/pages/static-unsupported/`, { waitUntil: "networkidle" });
            await ctx.expect(page.getByText("この本文は閲覧できる。")).toBeVisible();
          });
          await ctx.check(`${label}: ツリー・パンくず・見出し・前後移動`, async () => {
            await ctx.expect(page.getByRole("navigation", { name: "前後の文書" })).toBeVisible();
            await ctx.expect(page.getByRole("heading", { name: "表示できる本文" })).toBeVisible();
            await ctx.expect(page.getByRole("navigation", { name: /パンくず/ })).toBeAttached();
            if (width === 375) await page.getByRole("button", { name: "文書ナビゲーションを開く" }).click();
            await ctx.expect(page.getByRole("treegrid", { name: "文書" })).toBeVisible();
            if (width === 375) await page.getByRole("button", { name: "文書ナビゲーションを閉じる" }).click();
            const turner = page.getByRole("navigation", { name: "前後の文書" });
            await turner.getByRole("button").first().click();
            await ctx.expect(page.getByRole("heading", { name: "未対応block保持確認", level: 1 })).toHaveCount(0);
          });
          await ctx.check(`${label}: ハッシュ移動`, async () => {
            await page.goto(`${http.origin}${prefix}/pages/static-target/`, { waitUntil: "networkidle" });
            const heading = page.getByRole("heading", { name: "遷移先見出し" });
            const id = await heading.getAttribute("id");
            assert(id);
            await page.evaluate(id => { location.hash = id; }, id);
            assert.equal(decodeURIComponent(new URL(page.url()).hash.slice(1)), id);
            await ctx.expect(heading).toBeVisible();
          });
        }
        await ctx.check(`${prefix || "root"}: assets・dataを含め動的読み込みエラーがない`, async () => {
          assert.deepEqual(failures, []);
          assert(loaded.some(path => path.startsWith(`${prefix}/assets/`)), JSON.stringify(loaded));
          assert(loaded.some(path => path.startsWith(`${prefix}/data/`) && path.endsWith(".json")), JSON.stringify(loaded));
        });
        await page.context().close();
      }
    } finally { await http.close(); }
  }
}];
