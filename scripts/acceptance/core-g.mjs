import assert from "node:assert/strict";
import { parse, stringify } from "yaml";
import { createCoreWorkspace } from "./lib/core-fixture.mjs";

export const steps = [{
  id: "CORE-MANUAL-A16",
  title: "モバイル閲覧と実ブラウザ入力を確認する",
  async run(ctx) {
    ctx.note("macOS実機のChrome・Safari・FirefoxでのIME候補選択、確定、undo/redo、貼り付けは自動化できない。合成compositionの確認はcore-a.mjsのCORE-MANUAL-A07を参照。");
    const { root, contentRoot, editPage, page, origin } = await createCoreWorkspace(ctx);
    const file = ctx.path.join(root, contentRoot, editPage.relativePath);
    const doc = parse(await ctx.fs.readFile(file, "utf8"));
    doc.spec.blocks[0].content = "モバイル検索固有語\n\n## モバイル確認見出し\n\n本文を読むための文章です。\n";
    await ctx.fs.writeFile(file, stringify(doc));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${origin}/ja/pages/${editPage.name}/`, { waitUntil: "networkidle" });
    await ctx.expect(page.getByText("モバイル検索固有語")).toBeVisible();
    const button = (name) => page.getByRole("button", { name, exact: true });
    const open = button("文書ナビゲーションを開く");
    await ctx.check("本文を横scrollなしで読める。", async () => {
      const size = await page.locator("#document-content").evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
      assert(size.scroll <= size.client, JSON.stringify(size));
    });
    await ctx.check("drawerを開閉しfocusが起点に戻る。", async () => {
      await open.focus();
      await open.click();
      await ctx.expect(page.getByRole("dialog", { name: "文書ナビゲーション" })).toBeVisible();
      await button("文書ナビゲーションを閉じる").click();
      await ctx.expect(open).toBeFocused();
    });
    await ctx.check("FolderとPageへ到達できる。", async () => {
      await open.click();
      const drawer = page.getByRole("dialog", { name: "文書ナビゲーション" });
      await ctx.expect(drawer.getByRole("treegrid", { name: "文書" })).toBeVisible();
      await drawer.getByText("manual-acceptance", { exact: true }).click();
      await ctx.expect(page.getByRole("dialog", { name: "文書ナビゲーション" })).toBeHidden();
      await open.click();
      await drawer.getByRole("button", { name: "すべて展開" }).click();
      await drawer.getByText(editPage.title, { exact: true }).click();
      await ctx.expect(page.getByRole("heading", { name: editPage.title })).toBeVisible();
    });
    await ctx.check("検索からPageへ到達できる。", async () => {
      await button("全文検索を開く").click();
      await page.getByRole("textbox", { name: "文書を検索" }).fill("モバイル検索固有語");
      await page.getByRole("option").filter({ hasText: editPage.title }).first().click();
      await ctx.expect(page.getByRole("heading", { name: editPage.title })).toBeVisible();
    });
    await ctx.check("見出しへ到達できる。", async () => {
      await page.locator("summary").filter({ hasText: "見出し" }).click();
      await page.getByRole("link", { name: "モバイル確認見出し" }).first().click();
      await ctx.expect(page.getByRole("heading", { name: "モバイル確認見出し" })).toBeVisible();
    });
    await ctx.check("画面下部で前後移動を使える。", async () => {
      const nav = page.getByRole("navigation", { name: "前後の文書" });
      await nav.scrollIntoViewIfNeeded();
      const controls = nav.getByRole("button");
      assert.equal(await controls.count(), 2);
      await ctx.expect(controls.first()).toBeVisible();
      await controls.first().click();
      await ctx.expect(page.getByRole("heading", { name: editPage.title })).toHaveCount(0);
    });
    await ctx.check("編集・新規作成の操作は表示されない。", async () => {
      await ctx.expect(button("編集")).toBeHidden();
      await ctx.expect(button("新規作成")).toBeHidden();
    });
    await page.goto(`${origin}/ja/pages/${editPage.name}/`, { waitUntil: "networkidle" });
    await ctx.check("文字200%でも本文と操作が切れない。", async () => {
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await ctx.expect(page.getByText("モバイル検索固有語")).toBeVisible();
      await ctx.expect(open).toBeVisible();
      const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      assert(size.scroll <= size.client, JSON.stringify(size));
      await open.click();
      await ctx.expect(button("文書ナビゲーションを閉じる")).toBeVisible();
      await button("文書ナビゲーションを閉じる").click();
    });
  }
}];
