import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parse } from "yaml";

const options = ["--size", "small-team", "--method", "hybrid", "--level", "standard", "--language", "ja", "--content-root", "docs/content"];

async function files(ctx, root) {
  const entries = await ctx.fs.readdir(root, { recursive: true, withFileTypes: true });
  const result = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = ctx.path.join(entry.parentPath, entry.name);
    const relative = ctx.path.relative(root, file);
    if (relative.split(ctx.path.sep).includes(".git")) continue;
    result[relative] = await ctx.fs.readFile(file, "utf8");
  }
  return result;
}

export const steps = [
  { id: "CORE-MANUAL-B01", title: "完全な空状態から最初のPageを作る", async run(ctx) {
    const root = await ctx.temporary("core-f-empty");
    await ctx.fs.mkdir(ctx.path.join(root, "docs/content"), { recursive: true });
    await ctx.write(root, "vellym.config.yaml", 'schemaVersion: "1.0"\ncontentRoot: docs/content\noutputDir: dist/vellym\nui:\n  language: ja\nplugins: []\n');
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    await page.goto(server.origin, { waitUntil: "networkidle" });
    const button = (name) => page.getByRole("button", { name, exact: true });
    await ctx.check("serverはreadyで、初期セットアップへ戻らない。", async () => {
      assert.equal(server.server.exitCode, null);
      await ctx.expect(page.getByRole("list", { name: "セットアップの進行状況" })).toHaveCount(0);
    });
    await ctx.check("「まだ文書がありません」と次の操作が分かる。", async () => {
      await ctx.expect(page.getByText("まだ文書がありません")).toBeVisible();
      await ctx.expect(button("新規作成")).toBeVisible();
    });
    await ctx.check("空のツリー、検索0件、設定の問題0件が破綻しない。", async () => {
      await ctx.expect(page.getByRole("treegrid", { name: "文書" })).toBeVisible();
      await button("全文検索を開く").click();
      await page.getByRole("textbox", { name: "文書を検索" }).fill("存在しない検索語");
      await ctx.expect(page.getByText(/0件/).first()).toBeVisible();
      await page.keyboard.press("Escape");
      await button("設定").click();
      await ctx.expect(page.getByRole("heading", { name: "設定・管理詳細" })).toBeVisible();
      const response = await fetch(`${server.origin}/api/v1/repository`);
      assert(response.ok);
      const repository = await response.json();
      assert.equal(repository.diagnostics.length, 0);
      await ctx.expect(page.getByRole("region", { name: "読み込みの問題" }).getByText("読み込めない文書はありません。")).toBeVisible();
    });
    await page.goto(server.origin, { waitUntil: "networkidle" });
    await page.getByRole("treegrid", { name: "文書" }).waitFor();
    await ctx.check("構成管理から最初のFolderとPageを作れる。", async () => {
      for (const [kind, label, title] of [["フォルダ", "フォルダ名", "最初のフォルダ"], ["ページ", "ページタイトル", "最初のページ"]]) {
        await button("新規作成").click();
        await page.getByRole("menuitem", { name: kind, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await page.waitForLoadState("networkidle");
        await dialog.getByRole("textbox", { name: label }).fill(title);
        await dialog.getByRole("button", { name: "内容を確認", exact: true }).click();
        await ctx.expect(dialog.getByRole("button", { name: "この内容で作成", exact: true }), await dialog.innerText()).toBeVisible();
        await dialog.getByRole("button", { name: "この内容で作成", exact: true }).click();
        await ctx.expect(dialog).toBeHidden();
        await page.goto(server.origin, { waitUntil: "networkidle" });
        await page.getByRole("treegrid", { name: "文書" }).waitFor();
      }
      if (await button("保存").first().isVisible()) await button("保存").first().click();
    });
    await ctx.check("作成後、通常のworkspaceへ遷移し、`vellym validate`が1 Pageを返す。", async () => {
      await ctx.expect(page.getByRole("treegrid", { name: "文書" })).toBeVisible();
      const result = ctx.cli(root, "validate", "--json");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).data.pages.length, 1);
    });
  } },
  { id: "CORE-MANUAL-C01", title: "preview、初期化、validate、buildを通す", async run(ctx) {
    const root = await ctx.temporary("core-f-cli");
    ctx.git(root, "init", "-q");
    const preview = ctx.cli(root, "init", ...options, "--dry-run", "--json");
    let plan;
    await ctx.check("preview後は`.git`以外のfileが作成されない。", async () => {
      assert.equal(preview.status, 0, preview.stderr);
      plan = JSON.parse(preview.stdout);
      assert.deepEqual(await files(ctx, root), {});
    });
    if (!plan) ctx.blocked("CLI preview failed; no creation plan available");
    const apply = ctx.cli(root, "init", ...options);
    const after = await files(ctx, root);
    await ctx.check("apply後はpreviewと同じ候補が作成される。", async () => {
      assert.equal(apply.status, 0, apply.stdout + apply.stderr);
      assert.deepEqual(Object.keys(after).sort(), [...plan.create].sort());
    });
    await ctx.check("規模と方式の両方が提案するPageを二重に生成しない（previewの`create`にpathの重複が無く、生成したPageの`metadata.name`も重複しない）。", async () => {
      assert.equal(new Set(plan.create).size, plan.create.length);
      const names = Object.entries(after).filter(([name]) => name.endsWith(".yaml")).map(([, text]) => parse(text)).filter((value) => value?.kind === "Page").map((page) => page.metadata.name);
      assert(names.length > 0);
      assert.equal(new Set(names).size, names.length);
    });
    const validate = ctx.cli(root, "validate", "--json");
    const beforeBuild = await files(ctx, root);
    const build = ctx.cli(root, "build", "--json");
    await ctx.check("validateとbuildが0終了する。", async () => {
      assert.equal(validate.status, 0, validate.stdout + validate.stderr);
      assert.equal(build.status, 0, build.stdout + build.stderr);
    });
    await ctx.check("静的成果物はbuild実行後だけ存在する。", async () => {
      assert(!Object.keys(beforeBuild).some((name) => name.startsWith("dist/")));
      assert(Object.keys(await files(ctx, root)).some((name) => name.startsWith("dist/") && name.endsWith("index.html")));
    });
    const beforeSecond = await files(ctx, root);
    await ctx.check("CLIは既存内容を上書きせず、Git commitを行わない。", async () => {
      const second = ctx.cli(root, "init", ...options);
      assert.deepEqual(await files(ctx, root), beforeSecond, second.stdout + second.stderr);
      assert.notEqual(ctx.command(root, "git", ["rev-parse", "HEAD"]).status, 0);
    });
  } },
  { id: "CORE-MANUAL-D01", title: "ブラウザセットアップで既存fileを保護する", async run(ctx) {
    const outcomes = [];
    for (const alternate of [false, true]) {
    const root = await ctx.temporary("core-f-conflict");
    const existing = "apiVersion: vellym.tasclub.com/v1alpha1\nkind: Page\nmetadata:\n  name: existing-welcome\n  title: 既存のWelcome\nspec:\n  blocks:\n    - id: body\n      type: rich-text\n      format: commonmark\n      content: |\n        この文字列は上書き禁止: KEEP-EXISTING-WELCOME\n";
    await ctx.write(root, "docs/content/index.yaml", existing);
    const hash = (text) => createHash("sha256").update(text).digest("hex");
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    const button = (name) => page.getByRole("button", { name, exact: true });
    await page.goto(server.origin, { waitUntil: "networkidle" });
    await page.locator("dl > div").filter({ has: page.locator("dt", { hasText: "プロジェクト規模" }) }).locator("select").selectOption("small-team");
    await page.locator("dl > div").filter({ has: page.locator("dt", { hasText: "開発方式" }) }).locator("select").selectOption("hybrid");
    await page.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^content root$/ }) }).locator("input").fill("docs/content");
    await button("次へ").click();
    await page.getByRole("radio", { name: /^標準/ }).check();
    const planResponse = page.waitForResponse(async (response) => response.url().endsWith("/api/v1/setup/plan") && response.request().method() === "POST" && (await response.json()).data.files.some((file) => file.relativePath === "docs/content/index.yaml" && file.status === "skip"));
    await button("次へ").click();
    let plan = (await (await planResponse).json()).data;
    await button("この内容で生成").waitFor();
    await button("すべて展開").click();
    await ctx.check("`index.yaml`を既存項目として検出する。", async () => {
      assert(plan.files.some((file) => file.relativePath === "docs/content/index.yaml" && file.status === "skip"), JSON.stringify(plan.files.filter((file) => file.status === "skip")));
      await ctx.expect(page.getByText(/既存ファイルがあるためskip/).first()).toBeVisible();
    });
    await ctx.check("既定は「既存のため作成しない」で、無断上書きを選ばない。", async () => {
      await ctx.expect(page.getByText(/既存ファイルがあるためskip/).first()).toBeVisible();
      await ctx.expect(button("別名で作成").first()).toBeVisible();
    });
    if (alternate) await ctx.check("「別名で作成」を選ぶと`index-2.yaml`等の候補をpreviewする。", async () => {
      const response = page.waitForResponse((r) => r.url().endsWith("/api/v1/setup/plan") && r.request().method() === "POST");
      await button("別名で作成").first().click();
      plan = (await (await response).json()).data;
      await ctx.expect(page.locator('input[value="index-2.yaml"]')).toBeVisible();
    });
    await ctx.check("previewを開いただけではfileが変わらない。", async () => {
      assert.deepEqual(await files(ctx, root), { "docs/content/index.yaml": existing });
    });
    await button("この内容で生成").click();
    await button("プロジェクトを開く").click();
    await page.getByRole("treegrid", { name: "文書" }).waitFor();
    const after = await files(ctx, root);
    await ctx.check("apply後も既存fileのhashと`KEEP-EXISTING-WELCOME`が同じである。", async () => {
      assert.equal(hash(after["docs/content/index.yaml"]), hash(existing));
      assert.match(after["docs/content/index.yaml"], /KEEP-EXISTING-WELCOME/);
    });
    outcomes.push(Object.keys(after).sort());
    await ctx.check("生成されたファイルがpreviewの作成候補と一致する。", async () => {
      assert.deepEqual(Object.keys(after).filter((name) => name !== "docs/content/index.yaml").sort(), plan.files.filter((file) => file.status === "create").map((file) => file.relativePath).sort());
    });
    await ctx.check("他候補、設定、directoryが途中までしか作られた状態にならない。", async () => {
      assert(after["vellym.config.yaml"]);
      const result = ctx.cli(root, "validate");
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
    }
    await ctx.check("別名を選んだ場合だけ別Pageが追加される。", async () => {
      assert.deepEqual(outcomes[1].filter((name) => !outcomes[0].includes(name)), ["docs/content/index-2.yaml"]);
      assert.deepEqual(outcomes[0].filter((name) => !outcomes[1].includes(name)), []);
    });
  } },
];
