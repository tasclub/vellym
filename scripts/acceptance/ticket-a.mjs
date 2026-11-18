// Ticket management manual acceptance, section A (plugin install and activation).
// ticket-01m7p97tp8htrtkdv8z2dxs6xq. Packages come from local `npm pack` tarballs only;
// nothing is published or fetched from the public registry for our own packages.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const id = (number) => `TICKET-MANUAL-A${String(number).padStart(2, "0")}`;
const init = (ctx, cwd, target, ...extra) => ctx.cli(cwd, "init", target, "--size", "personal", "--method", "hybrid", "--language", "ja", "--level", "light", ...extra);
const run = (cwd, command, args, timeout = 300_000) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout });
  if (result.error) throw result.error;
  return result;
};

/** Tarballs of vellym, plugin-api and the ticket plugin, packed once per run. */
async function tarballs(ctx) {
  if (ctx.state.ticketTarballs) return ctx.state.ticketTarballs;
  const destination = await ctx.temporary("ticket-pack");
  const files = {};
  for (const workspace of ["vellym", "@vellym/plugin-api", "@vellym/tickets"]) {
    const result = run(ctx.repository, "npm", ["pack", "--workspace", workspace, "--pack-destination", destination, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    files[workspace] = ctx.path.join(destination, JSON.parse(result.stdout)[0].filename);
  }
  ctx.state.ticketTarballs = files;
  return files;
}

export const steps = [
  { id: id(1), title: "initがpackage.jsonを生成する", async run(ctx) {
    const root = await ctx.temporary("ticket-a01");
    const target = ctx.path.join(root, "日本語 の Project");
    await ctx.fs.mkdir(target);
    const result = init(ctx, root, target);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const manifest = JSON.parse(await ctx.fs.readFile(ctx.path.join(target, "package.json"), "utf8"));
    await ctx.check("name・version・private: true・type: moduleの4つだけで、scriptsとdependenciesが無い", async () => {
      assert.deepEqual(Object.keys(manifest).sort(), ["name", "private", "type", "version"]);
      assert.equal(manifest.private, true);
      assert.equal(manifest.type, "module");
    });
    await ctx.check("日本語と空白を含むディレクトリ名から、npmの命名規則に沿った名前になる", async () => {
      assert.match(manifest.name, /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/);
      assert(manifest.name.length <= 214);
    });
    await ctx.check("vellym.config.yamlのpluginsが空配列", async () => {
      assert.match(await ctx.fs.readFile(ctx.path.join(target, "vellym.config.yaml"), "utf8"), /^plugins: \[\]$/m);
    });
    await ctx.check("既にpackage.jsonがあると、再実行しても1文字も変わらない", async () => {
      const existing = ctx.path.join(root, "existing");
      await ctx.fs.mkdir(existing);
      const original = '{\n  "name": "keep-me",\n  "version": "9.9.9",\n  "scripts": { "x": "echo" }\n}\n';
      await ctx.fs.writeFile(ctx.path.join(existing, "package.json"), original);
      init(ctx, root, existing);
      assert.equal(await ctx.fs.readFile(ctx.path.join(existing, "package.json"), "utf8"), original);
      init(ctx, root, existing);
      assert.equal(await ctx.fs.readFile(ctx.path.join(existing, "package.json"), "utf8"), original);
    });
    // Known failure on 2026-11-18: an existing package.json is planned as a conflict, so init stops
    // without writing anything (ticket-01m7q82gf3f03qq1r3f1kk9an8).
    ctx.note("既存・壊れたpackage.jsonでinitが止まる不具合: ticket-01m7q82gf3f03qq1r3f1kk9an8");
    await ctx.check("壊れたJSONのpackage.jsonは書き換えず、診断を示し、initの他の処理は完了する", async () => {
      const broken = ctx.path.join(root, "broken");
      await ctx.fs.mkdir(broken);
      await ctx.fs.writeFile(ctx.path.join(broken, "package.json"), "{broken");
      const outcome = init(ctx, root, broken);
      assert.equal(await ctx.fs.readFile(ctx.path.join(broken, "package.json"), "utf8"), "{broken");
      assert.match(outcome.stdout + outcome.stderr, /package\.json/);
      await ctx.fs.access(ctx.path.join(broken, "vellym.config.yaml"));
    });
  } },

  { id: id(2), title: "プラグインを導入して有効化する", async run(ctx) {
    const packs = await tarballs(ctx);
    const root = await ctx.temporary("ticket-a02");
    const result = init(ctx, ctx.repository, root, "--plugins", "tickets");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const install = run(root, "npm", ["install", "--no-audit", "--no-fund", packs.vellym, packs["@vellym/plugin-api"], packs["@vellym/tickets"]]);
    assert.equal(install.status, 0, install.stderr);
    const server = await ctx.start(root);
    const bootstrap = await (await fetch(`${server.origin}/api/v1/bootstrap`)).json();
    await ctx.check("起動時にプラグイン読み込みの失敗が出ていない", async () => {
      assert.deepEqual(bootstrap.diagnostics.filter((item) => /PLUGIN/.test(item.code ?? "")), []);
      assert.doesNotMatch(server.log(), /PLUGIN_|プラグイン.*(失敗|読み込めません)/);
    });
    await ctx.check("サイドバー（文書ツリーの追加メニュー）にチケット管理の項目が現れる", async () => {
      const page = await ctx.page(server.origin);
      ctx.state.page = page;
      await page.goto(server.origin, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "新規作成", exact: true }).click();
      await ctx.expect(page.getByRole("menuitem", { name: "チケット管理" })).toBeVisible();
      await page.keyboard.press("Escape");
    });
    await ctx.check("チケット一覧が開ける", async () => {
      const page = ctx.state.page;
      await page.getByRole("button", { name: "新規作成", exact: true }).click();
      await page.getByRole("menuitem", { name: "チケット管理" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").first().fill("acceptance-tracker");
      await dialog.getByRole("button", { name: "チケット管理" }).click();
      await page.getByRole("button", { name: "保存", exact: true }).first().click();
      await ctx.expect(page.getByRole("button", { name: "チケット一覧", exact: true })).toBeVisible({ timeout: 15_000 });
    });
    await server.stop();
  } },

  { id: id(3), title: "npxで実行してもCLI側の依存を拾わない", async run(ctx) {
    const packs = await tarballs(ctx);
    // A project that names the plugin but has only vellym installed: the CLI's own
    // dependencies must not satisfy it.
    const root = await ctx.temporary("ticket-a03");
    assert.equal(init(ctx, ctx.repository, root).status, 0);
    const config = ctx.path.join(root, "vellym.config.yaml");
    await ctx.fs.writeFile(config, (await ctx.fs.readFile(config, "utf8")).replace("plugins: []", 'plugins:\n  - "@vellym/tickets"'));
    const install = run(root, "npm", ["install", "--no-audit", "--no-fund", packs.vellym]);
    assert.equal(install.status, 0, install.stderr);
    const server = await ctx.start(root);
    const bootstrap = await (await fetch(`${server.origin}/api/v1/bootstrap`)).json();
    await ctx.check("解決できない旨が診断として示され、serverは起動する", async () => {
      assert.equal(server.server.exitCode, null);
      assert(bootstrap.diagnostics.some((item) => JSON.stringify(item).includes("@vellym/tickets")), JSON.stringify(bootstrap.diagnostics));
    });
    const page = await ctx.page(server.origin);
    ctx.state.page = page;
    await page.goto(server.origin, { waitUntil: "networkidle" });
    await ctx.check("文書ツリーが使える", async () => {
      await ctx.expect(page.getByRole("treegrid").first()).toBeVisible();
    });
    await ctx.check("検索が使える", async () => {
      const results = await ctx.json(server.origin, "search?q=%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88");
      assert(Array.isArray(results.results ?? results.hits ?? results));
    });
    await ctx.check("本文の編集が始められる", async () => {
      const repository = await ctx.json(server.origin, "repository");
      const first = (repository.pages ?? []).find((item) => item.name);
      assert(first, "no page in the generated project");
      await page.goto(`${server.origin}/ja/pages/${first.name}/`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "編集", exact: true }).click();
      await ctx.expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
      await page.getByRole("button", { name: "キャンセル", exact: true }).first().click();
    });
    ctx.note("npxそのものではなく、プロジェクトに入れたvellymのtarballをnode_modules/.binから起動した。CLIの依存（packages/vellym）にプラグインが無い状態で、プロジェクトに入っていないプラグインを拾わないことを確かめている。");
    await server.stop();
  } }
];
