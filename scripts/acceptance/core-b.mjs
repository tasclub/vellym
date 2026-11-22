import assert from "node:assert/strict";

export const steps = [
  { id: "CORE-MANUAL-D02", title: "壊れた設定を未初期化として上書きしない", async run(ctx) {
    const root = await ctx.temporary("core-config-error");
    const config = "schemaVersion: [\n";
    await ctx.write(root, "vellym.config.yaml", config);
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    await page.goto(server.origin, { waitUntil: "networkidle" });
    await ctx.check("設定エラーと解析理由を表示し初期セットアップへ進まない", async () => {
      await ctx.expect(page.getByText(/設定ファイルを確認してください/)).toBeVisible();
      await ctx.expect(page.getByRole("list", { name: "セットアップの進行状況" })).toHaveCount(0);
      await ctx.expect(page.locator("body")).toContainText(/YAML|解析|schemaVersion/i);
      await ctx.expect(page.getByText(/line 2/)).toBeVisible();
    });
    await ctx.check("CLIも設定エラーを報告し、設定とディレクトリを変更しない", async () => {
      const result = ctx.cli(root, "validate");
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /yaml|schemaVersion|config|設定/i);
      assert.equal(await ctx.fs.readFile(ctx.path.join(root, "vellym.config.yaml"), "utf8"), config);
      assert.deepEqual((await ctx.fs.readdir(root)).sort(), ["vellym.config.yaml"]);
    });
  } }
];
