// Ticket management manual acceptance, section D (removing and breaking plugins).
// ticket-01m7p97tp8htrtkdv8z2dxs6xq. Plugins come from this repository's workspaces (linked
// into the temporary project); broken plugins are small fakes written into that project only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const id = (number) => `TICKET-MANUAL-D${String(number).padStart(2, "0")}`;
export const TRACKER = "acc-tracker";
export const TICKETS = ["ticket-01accd0000000000000000001", "ticket-01accd0000000000000000002"];
const ticketYaml = (name, title, status) => `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata:
  name: ${name}
  title: ${title}
spec:
  status: ${status}
  fields:
    priority: high
  blocks:
    - id: body
      type: rich-text
      content: "${title}の本文。受入確認のための説明。"
`;

/** A project with the ticket plugin, a tracker, two tickets and a page linking to one. */
export async function project(ctx, plugins = ["@vellym/tickets"]) {
  const root = await ctx.temporary("ticket-d");
  const modules = ctx.path.join(root, "node_modules");
  await ctx.fs.mkdir(modules, { recursive: true });
  await ctx.fs.symlink(ctx.path.join(ctx.repository, "node_modules/@vellym"), ctx.path.join(modules, "@vellym"), "dir");
  await ctx.write(root, ".gitignore", "node_modules\ndist\n");
  await config(ctx, root, plugins);
  await ctx.write(root, "content/work/tracker.yaml", `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: ${TRACKER}, title: 受入の作業 }
spec:
  statuses:
    - { id: open, label: 未着手, category: open }
    - { id: done, label: 完了, category: closed }
  fields:
    - { id: priority, label: 優先度, type: select, listColumn: true, options: [{ value: high, label: 高 }, { value: low, label: 低 }] }
`);
  await ctx.write(root, `content/work/+tickets/${TICKETS[0]}.yaml`, ticketYaml(TICKETS[0], "通知を見直す", "open"));
  await ctx.write(root, `content/work/+tickets/${TICKETS[1]}.yaml`, ticketYaml(TICKETS[1], "検索を速くする", "done"));
  await ctx.write(root, "content/guide.yaml", `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata: { name: guide, title: 案内 }
spec:
  locale: ja
  blocks:
    - id: body
      type: rich-text
      content: "関係するチケットは[[${TICKETS[0]}]]を見る。"
`);
  ctx.git(root, "init", "-q");
  ctx.git(root, "config", "user.name", "Acceptance");
  ctx.git(root, "config", "user.email", "acceptance@example.invalid");
  ctx.git(root, "config", "commit.gpgSign", "false");
  ctx.git(root, "add", ".");
  ctx.git(root, "commit", "-qm", "baseline");
  return root;
}
async function config(ctx, root, plugins) {
  const list = plugins.length ? `\n${plugins.map((name) => `  - "${name}"`).join("\n")}` : " []";
  await ctx.write(root, "vellym.config.yaml", `schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist/site\nui:\n  language: ja\ni18n:\n  defaultLocale: ja\nplugins:${list}\n`);
}
/** A fake plugin package in the project's node_modules. */
async function fakePlugin(ctx, root, name, { engines = ">=0.5.0-beta", node, browser, manifestId }) {
  const directory = ctx.path.join(root, "node_modules", ...name.split("/"));
  await ctx.fs.mkdir(ctx.path.join(directory, "browser"), { recursive: true });
  const manifest = { id: manifestId, contributes: {
    kinds: [{ kind: "Gadget", showInDocumentTree: true, hasBlocks: false }],
    views: [{ id: "gadget.board", kind: "Gadget", type: "list", static: true }]
  } };
  await ctx.fs.writeFile(ctx.path.join(directory, "package.json"), JSON.stringify({
    name, version: "1.0.0", type: "module",
    exports: { ".": "./index.mjs", ...(browser === undefined ? {} : { "./browser": "./browser/index.js" }) },
    engines: { vellym: engines }, vellym: manifest
  }));
  await ctx.fs.writeFile(ctx.path.join(directory, "index.mjs"), node ?? `export function activate(host) {
  host.registerKind({ kind: "Gadget" });
  host.registerView({ id: "gadget.board", opensKind: "Gadget", view: () => ({ type: "list", id: "gadget.board", kind: "Gadget", title: { ja: "道具", en: "Gadgets" }, columns: [] }) });
}
`);
  if (browser !== undefined) await ctx.fs.writeFile(ctx.path.join(directory, "browser/index.js"), browser);
}
const gadget = `apiVersion: vellym.tasclub.com/v1\nkind: Gadget\nmetadata: { name: gadget-one, title: 道具 }\nspec: {}\n`;

/** The three things a broken plugin must never take away: tree, search, and editing a page. */
async function coreStillWorks(ctx, origin, label) {
  const page = await ctx.page(origin);
  ctx.state.page = page;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
  await ctx.check(`${label}: 文書ツリーが使える`, async () => {
    await ctx.expect(page.getByRole("treegrid").first()).toBeVisible();
    await ctx.expect(page.getByRole("heading", { level: 1, name: "案内" })).toBeVisible();
  });
  await ctx.check(`${label}: 全文検索が使える`, async () => {
    await page.getByRole("button", { name: "全文検索を開く" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").or(dialog.getByRole("searchbox")).or(dialog.getByRole("textbox")).first().fill("案内");
    await ctx.expect(dialog.getByText("案内").first()).toBeVisible();
    await page.keyboard.press("Escape");
  });
  await ctx.check(`${label}: 本文を編集して保存できる`, async () => {
    await page.getByRole("button", { name: "編集", exact: true }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(` ${label}`);
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "保存", exact: true }).first().click();
    await ctx.expect(page.getByRole("button", { name: "編集", exact: true })).toBeVisible();
  });
  return { page, errors };
}
const validateAndBuild = (ctx, root) => ({
  validate: ctx.cli(root, "validate", "--json", "--config", ctx.path.join(root, "vellym.config.yaml")),
  build: spawnSync(process.execPath, [ctx.path.join(ctx.repository, "packages/vellym/dist/cli.mjs"), "build", "--json", "--config", ctx.path.join(root, "vellym.config.yaml")], { cwd: root, encoding: "utf8", timeout: 120_000 })
});

export const steps = [
  { id: id(1), title: "プラグインを外す", async run(ctx) {
    const root = await project(ctx);
    await config(ctx, root, []);
    ctx.git(root, "commit", "-qam", "remove plugins");
    ctx.state.ticketD = { root };
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    ctx.state.page = page;
    const bootstrap = await (await fetch(`${server.origin}/api/v1/bootstrap`)).json();
    await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
    await ctx.check("チケットのナビゲーション項目が現れない（disabledでも残らない）", async () => {
      assert.deepEqual(bootstrap.data.plugins.documentTreeCommands, []);
      await page.getByRole("button", { name: "新規作成", exact: true }).click();
      await ctx.expect(page.getByRole("menuitem", { name: "チケット管理" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    });
    await ctx.check("チケットもTicketTrackerも文書ツリーに出ない", async () => {
      const tree = page.getByRole("treegrid").first();
      await ctx.expect(tree.getByText("受入の作業")).toHaveCount(0);
      await ctx.expect(tree.getByText("通知を見直す")).toHaveCount(0);
    });
    await ctx.check("全文検索でチケットのタイトルと本文が引ける", async () => {
      const titles = JSON.stringify(await ctx.json(server.origin, `search?q=${encodeURIComponent("通知を見直す")}`));
      const bodies = JSON.stringify(await ctx.json(server.origin, `search?q=${encodeURIComponent("受入確認のための説明")}`));
      assert(titles.includes(TICKETS[0]), titles.slice(0, 300));
      assert(bodies.includes(TICKETS[0]), bodies.slice(0, 300));
    });
    await ctx.check("内部リンクからチケットへ到達でき、本文が読める", async () => {
      await page.getByRole("link", { name: /通知を見直す|ticket-01accd/ }).first().click();
      await ctx.expect(page.getByRole("heading", { level: 1, name: "通知を見直す" })).toBeVisible();
      await ctx.expect(page.getByText("通知を見直すの本文")).toBeVisible();
    });
    await ctx.check("設定・管理詳細の「解釈できない内容」に、kindごとの件数と一覧が出る", async () => {
      await page.getByRole("button", { name: /^設定/ }).first().click();
      const text = await page.locator("main").innerText();
      ctx.note(`設定画面のTicketを含む行: ${text.split("\n").filter((line) => /Ticket/.test(line)).slice(0, 6).join(" / ")}`);
      assert(/Ticket/.test(text) && /TicketTracker/.test(text), "設定画面にTicket・TicketTrackerの種別が出ていない");
      assert(/Ticket[^\n]*2/.test(text), "Ticketの件数（2）が出ていない");
    });
    await ctx.check("この状態でチケットを開いて保存しても、spec.statusとspec.fieldsが消えない", async () => {
      await page.goto(`${server.origin}/ja/pages/${TICKETS[0]}/`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "編集", exact: true }).click();
      const editor = page.locator('[contenteditable="true"]').first();
      await editor.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" D01で追記");
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "保存", exact: true }).first().click();
      await ctx.expect(page.getByRole("button", { name: "編集", exact: true })).toBeVisible();
      const saved = await ctx.fs.readFile(ctx.path.join(root, `content/work/+tickets/${TICKETS[0]}.yaml`), "utf8");
      assert.match(saved, /D01で追記/);
      assert.match(saved, /^  status: open$/m);
      assert.match(saved, /^    priority: high$/m);
    });
    await ctx.check("チケットのファイルが移動も削除も変換もされていない", async () => {
      const status = ctx.git(root, "status", "--short").split("\n").filter(Boolean);
      assert.deepEqual(status.map((line) => line.trim()), [`M content/work/+tickets/${TICKETS[0]}.yaml`]);
    });
    await server.stop();
  } },

  { id: id(2), title: "外した状態でvalidateとbuild", async run(ctx) {
    const root = ctx.state.ticketD?.root ?? ctx.blocked("D01の領域が無い");
    const { validate, build } = validateAndBuild(ctx, root);
    await ctx.check("validateが終了コード0で終わり、未知kindがwarningとして出る", async () => {
      assert.equal(validate.status, 0, validate.stdout + validate.stderr);
      const diagnostics = JSON.parse(validate.stdout).diagnostics;
      assert(diagnostics.some((item) => item.code === "UNKNOWN_RESOURCE_KIND" && item.severity === "warning"));
    });
    await ctx.check("buildが成功する", async () => {
      assert.equal(build.status, 0, build.stdout + build.stderr);
    });
    await ctx.check("静的サイトでチケットが本文を持つ文書として読め、内部リンクから到達でき、文書ツリーには出ない", async () => {
      const output = JSON.parse(build.stdout).data.outputDir;
      const buildInfo = JSON.parse(await ctx.fs.readFile(ctx.path.join(output, "vellym-build.json"), "utf8"));
      const data = ctx.path.join(output, "data", buildInfo.buildId, "ja");
      const ticket = await ctx.fs.readFile(ctx.path.join(data, "pages", `${TICKETS[0]}.json`), "utf8");
      assert.match(ticket, /通知を見直すの本文/);
      const tree = await ctx.fs.readFile(ctx.path.join(data, "repository.json"), "utf8");
      assert(!tree.includes(`"${TICKETS[0]}"`), "repository.json（文書ツリー）にチケットがある");
      await ctx.fs.access(ctx.path.join(output, "pages", TICKETS[0], "index.html"));
      const guide = await ctx.fs.readFile(ctx.path.join(data, "pages", "guide.json"), "utf8");
      assert(guide.includes(TICKETS[0]), "案内のページからチケットへの内部リンクが解決されていない");
    });
    // The static site has no full-text search, and none is required for now (user, 2026-11-18).
  } },

  { id: id(3), title: "壊れたプラグインを指す", async run(ctx) {
    const variants = [
      { label: "存在しないパッケージ", name: "@acceptance/missing", make: async () => {} },
      { label: "engines.vellymが版域外", name: "@acceptance/too-new", make: (root) => fakePlugin(ctx, root, "@acceptance/too-new", { engines: ">=99.0.0", manifestId: "too-new" }) },
      { label: "activateが例外を投げる", name: "@acceptance/throws", make: (root) => fakePlugin(ctx, root, "@acceptance/throws", { manifestId: "throws", node: "export function activate() { throw new Error('受入: activateで失敗'); }\n" }) },
      { label: "ブラウザ側バンドルが読み込めない", name: "@acceptance/bad-bundle", make: (root) => fakePlugin(ctx, root, "@acceptance/bad-bundle", { manifestId: "bad-bundle", browser: "export default {{{ syntax error\n" }) }
    ];
    for (const variant of variants) {
      const root = await project(ctx, ["@vellym/tickets", variant.name]);
      await variant.make(root);
      await ctx.write(root, "content/gadgets/gadget-one.yaml", gadget);
      const server = await ctx.start(root);
      await ctx.check(`${variant.label}: devが起動する`, async () => assert.equal(server.server.exitCode, null));
      const { page, errors } = await coreStillWorks(ctx, server.origin, variant.label);
      await ctx.check(`${variant.label}: 何が読み込めなかったかが、プラグインの名前と原因つきで示される`, async () => {
        const bootstrap = await (await fetch(`${server.origin}/api/v1/bootstrap`)).json();
        const shown = JSON.stringify(bootstrap.diagnostics) + await page.locator("body").innerText();
        if (variant.label.startsWith("ブラウザ")) {
          // The bundle fails in the browser; the screen of that plugin must name it.
          await page.goto(`${server.origin}/ja/pages/gadget-one/`, { waitUntil: "networkidle" });
          const text = await page.locator("main").innerText();
          assert(/bad-bundle/.test(text), `画面にプラグイン名が無い: ${text.slice(0, 300)}`);
        } else {
          assert(shown.includes(variant.name), `診断にプラグイン名が無い: ${shown.slice(0, 400)}`);
        }
      });
      ctx.note(`${variant.label}: pageerror ${errors.length}件`);
      await server.stop();
      const { validate, build } = validateAndBuild(ctx, root);
      await ctx.check(`${variant.label}: validateとbuildが失敗しない`, async () => {
        assert.equal(validate.status, 0, validate.stdout.slice(0, 400) + validate.stderr);
        assert.equal(build.status, 0, build.stdout.slice(0, 400) + build.stderr);
      });
    }
  } },

  { id: id(4), title: "有効化し直す", async run(ctx) {
    const root = ctx.state.ticketD?.root ?? ctx.blocked("D01の領域が無い");
    await config(ctx, root, ["@vellym/tickets"]);
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    ctx.state.page = page;
    await ctx.check("一覧と詳細が元どおり表示される", async () => {
      await page.goto(`${server.origin}/ja/pages/${TRACKER}/`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "チケット一覧", exact: true }).click().catch(() => {});
      await ctx.expect(page.getByRole("table").first()).toContainText("通知を見直す");
      await page.goto(`${server.origin}/ja/pages/${TICKETS[0]}/`, { waitUntil: "networkidle" });
      await ctx.expect(page.locator('dl[class*="plugin-detail-fields"]')).toContainText("高");
    });
    await ctx.check("「解釈できない内容」から該当kindが消える", async () => {
      const result = ctx.cli(root, "validate", "--json", "--config", ctx.path.join(root, "vellym.config.yaml"));
      assert(!JSON.parse(result.stdout).diagnostics.some((item) => item.code === "UNKNOWN_RESOURCE_KIND"));
    });
    await ctx.check("D01で保存したチケットの値が正しく読まれている", async () => {
      await ctx.expect(page.getByText("D01で追記")).toBeVisible();
      await ctx.expect(page.locator('dl[class*="plugin-detail-fields"]')).toContainText("未着手");
    });
    await server.stop();
  } },

  { id: id(5), title: "プラグインの画面が描画中に落ちる", async run(ctx) {
    const root = await project(ctx, ["@vellym/tickets", "@acceptance/render-throws"]);
    await fakePlugin(ctx, root, "@acceptance/render-throws", { manifestId: "render-throws",
      browser: "export default { activate(host) { host.registerViewRenderer('gadget.board', { mount() { throw new Error('試験: 描画中に落ちました'); } }); } };\n" });
    await ctx.write(root, "content/gadgets/gadget-one.yaml", gadget);
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    ctx.state.page = page;
    await page.goto(`${server.origin}/ja/pages/gadget-one/`, { waitUntil: "networkidle" });
    await ctx.check("その画面の位置にだけ診断が出て、原因の文言が読める", async () => {
      await ctx.expect(page.locator("main")).toContainText("試験: 描画中に落ちました");
      await ctx.expect(page.getByRole("treegrid").first()).toBeVisible();
    });
    await ctx.check("画面全体が白紙にならない", async () => {
      assert((await page.locator("body").innerText()).trim().length > 50);
    });
    await ctx.check("別のビューへ移ると、前の失敗を持ち越さない", async () => {
      await page.getByRole("treegrid").first().getByText("案内", { exact: true }).click();
      await ctx.expect(page.getByRole("heading", { level: 1, name: "案内" })).toBeVisible();
      await ctx.expect(page.locator("main")).not.toContainText("試験: 描画中に落ちました");
    });
    await server.stop();
    const again = await ctx.start(root);
    await coreStillWorks(ctx, again.origin, "描画中の失敗");
    await again.stop();
  } },

  { id: id(6), title: "複数のプラグインのうち1つが壊れる", async run(ctx) {
    const root = await project(ctx, ["@vellym/tickets", "@acceptance/throws"]);
    await fakePlugin(ctx, root, "@acceptance/throws", { manifestId: "throws", node: "export function activate() { throw new Error('受入: activateで失敗'); }\n" });
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    ctx.state.page = page;
    await ctx.check("壊れていない側（チケット）の画面は動く", async () => {
      await page.goto(`${server.origin}/ja/pages/${TRACKER}/`, { waitUntil: "networkidle" });
      await ctx.expect(page.getByRole("table").first()).toContainText("通知を見直す");
    });
    await ctx.check("どちらのプラグインが失敗したかが名前で分かる", async () => {
      const bootstrap = await (await fetch(`${server.origin}/api/v1/bootstrap`)).json();
      const text = JSON.stringify(bootstrap.diagnostics);
      assert(text.includes("@acceptance/throws"), text.slice(0, 400));
      assert(!text.includes("@vellym/tickets"), "壊れていない側が失敗として出ている");
    });
    await server.stop();
  } }
];
