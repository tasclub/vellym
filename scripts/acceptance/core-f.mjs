import assert from "node:assert/strict";

// CORE-MANUAL-C01・D01 moved to e2e/acceptance/core-setup-f.spec.ts (2026-11-27).
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
];
