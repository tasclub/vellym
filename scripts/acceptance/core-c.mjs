import assert from "node:assert/strict";
import { parse, stringify } from "yaml";
import { createCoreWorkspace } from "./lib/core-fixture.mjs";

const button = (page, name) => page.getByRole("button", { name, exact: true });
async function workspace(ctx) {
  if (!ctx.state.root) Object.assign(ctx.state, await createCoreWorkspace(ctx));
  return ctx.state;
}
async function beginEdit(ctx) {
  const { page, origin, editPage } = ctx.state;
  await page.goto(`${origin}/ja/pages/${editPage.name}/`, { waitUntil: "networkidle" });
  await button(page, "編集").click();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.waitFor();
  return editor;
}
async function append(page, editor, text) {
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(text);
  await page.getByText("未保存", { exact: true }).first().waitFor();
}

export const steps = [
  { id: "CORE-MANUAL-A09", title: "外部変更と競合を確認する", async run(ctx) {
    const { page, root, contentRoot, editPage } = await workspace(ctx);
    const file = ctx.path.join(root, contentRoot, editPage.relativePath);
    const editor = await beginEdit(ctx);
    await append(page, editor, "画面側の競合入力");
    const external = parse(await ctx.fs.readFile(file, "utf8"));
    external.spec.blocks[0].content += "外部側の競合入力\n";
    await ctx.fs.writeFile(file, stringify(external));
    await ctx.check("外部変更を監視で検出する。", () => ctx.expect(page.getByText("YAMLが外部で変更されました。")).toBeVisible({ timeout: 15000 }));
    await ctx.check("画面側入力を無断で上書きしない。", () => ctx.expect(editor).toContainText("画面側の競合入力"));
    await button(page, "保存").first().click();
    await ctx.check("保存は競合になり、画面側とYAML側の内容を比較できる。", async () => {
      await ctx.expect(page.getByText("外部の変更と競合しました。")).toBeVisible();
      await page.getByText("版の違いを確認", { exact: true }).click();
      const comparison = page.locator("details").filter({ hasText: "版の違いを確認" });
      await ctx.expect(comparison).toContainText("画面側の競合入力");
      await ctx.expect(comparison).toContainText("外部側の競合入力");
    });
    await ctx.check("「編集中の内容をコピー」でclipboardへ退避できる。", async () => {
      await button(page, "編集中の内容をコピー").click();
      assert((await page.evaluate(() => navigator.clipboard.readText())).includes("画面側の競合入力"));
    });
    await ctx.check("YAML側を選ぶと外部内容になり、画面側を選ぶと未保存状態として残る。", async () => {
      await button(page, "YAMLの版を採用").click();
      await ctx.expect(page.locator("#document-content")).toContainText("外部側の競合入力");
      const again = await beginEdit(ctx);
      await append(page, again, "画面側の競合入力2");
      const latest = parse(await ctx.fs.readFile(file, "utf8"));
      latest.spec.blocks[0].content += "外部側の競合入力2\n";
      await ctx.fs.writeFile(file, stringify(latest));
      await ctx.expect(page.getByText("YAMLが外部で変更されました。")).toBeVisible({ timeout: 15000 });
      await button(page, "保存").first().click();
      await button(page, "編集中の版を採用").click();
      await ctx.expect(page.getByText("未保存", { exact: true }).first()).toBeVisible();
      await ctx.expect(again).toContainText("画面側の競合入力2");
      await button(page, "保存").first().click();
      await button(page, "編集").waitFor();
      assert((await ctx.fs.readFile(file, "utf8")).includes("画面側の競合入力2"));
      const validation = ctx.cli(root, "validate");
      assert.equal(validation.status, 0, validation.stdout + validation.stderr);
      ctx.note(ctx.git(root, "diff", "--", file));
    });
  } },
  { id: "CORE-MANUAL-A10", title: "保存失敗、入力保持、再試行を確認する", async run(ctx) {
    // A09 may leave a conflict open; use an independent disposable workspace.
    Object.assign(ctx.state, await createCoreWorkspace(ctx));
    const { page, root, contentRoot, editPage, generated } = ctx.state;
    const file = ctx.path.join(root, contentRoot, editPage.relativePath);
    const dir = ctx.path.dirname(file);
    const mode = (await ctx.fs.stat(dir)).mode & 0o777;
    try {
      await ctx.fs.chmod(dir, mode & ~0o200);
      if (process.getuid?.() === 0) ctx.blocked("rootのため書込不可を再現できない");
      try {
        await ctx.fs.access(dir, 2);
        ctx.blocked("filesystemのため書込不可を再現できない");
      } catch (error) {
        if (error.blocked) throw error;
        if (error.code !== "EACCES") throw error;
      }
      const editor = await beginEdit(ctx);
      await append(page, editor, "保存失敗後も残る入力");
      await button(page, "保存").first().click();
      await ctx.check("保存失敗が見逃せない位置に表示される。", () => ctx.expect(page.getByRole("alert").getByText("保存できませんでした。")).toBeVisible());
      await ctx.check("入力が消えず編集状態のまま残る。", () => ctx.expect(editor).toContainText("保存失敗後も残る入力"));
      await ctx.check("再試行と「編集中の内容をコピー」を利用できる。", async () => {
        await ctx.expect(button(page, "もう一度保存")).toBeVisible();
        await button(page, "編集中の内容をコピー").click();
        assert((await page.evaluate(() => navigator.clipboard.readText())).includes("保存失敗後も残る入力"));
      });
      await ctx.check("他のPageへ移動しようとすると未保存確認が出る。", async () => {
        const other = generated.pages.find((item) => item.name !== editPage.name);
        await page.getByRole("treegrid", { name: "文書", exact: true }).getByText(other.title, { exact: true }).first().click();
        await ctx.expect(page.getByRole("heading", { name: "未保存の変更があります" })).toBeVisible();
        await button(page, "編集を続ける").click();
      });
      await ctx.fs.chmod(dir, mode);
      await button(page, "もう一度保存").click();
      await button(page, "編集").waitFor();
      assert((await ctx.fs.readFile(file, "utf8")).includes("保存失敗後も残る入力"));
      const validation = ctx.cli(root, "validate");
      assert.equal(validation.status, 0, validation.stdout + validation.stderr);
    } finally {
      await ctx.fs.chmod(dir, mode);
    }
  } },
  { id: "CORE-MANUAL-A11", title: "Folder表示、移動、並べ替えを確認する", async run(ctx) {
    const fixture = await createCoreWorkspace(ctx);
    Object.assign(ctx.state, fixture);
    const { page, root, contentRoot, origin, editPage, archivePages } = fixture;
    const base = ctx.path.join(root, contentRoot);
    const tree = page.getByRole("treegrid", { name: "文書", exact: true });
    const row = (name) => tree.getByRole("row").filter({ has: button(page, `${name}の操作`) });
    const menu = async (name, action) => {
      await button(row(name), `${name}の操作`).click();
      await page.getByRole("menuitem", { name: action, exact: true }).click();
    };
    const dialog = page.getByRole("dialog");
    const indexes = async () => (await ctx.fs.readdir(base, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name === "_index.yaml")
      .map((entry) => ctx.path.relative(base, ctx.path.join(entry.parentPath, entry.name))).sort();
    const initialIndexes = await indexes();
    await page.goto(origin, { waitUntil: "networkidle" });
    await menu("manual-archive-target", "表示情報を編集");
    await dialog.getByRole("textbox", { name: "表示名", exact: true }).fill("手動受入・削除対象");
    await dialog.getByRole("textbox", { name: "説明（任意）", exact: true }).fill("配下をまとめてアーカイブする試験Folder");
    await button(dialog, "保存").click();
    await ctx.expect(dialog).toBeHidden();
    for (const name of ["manual-acceptance", "level-2", "level-3", "level-4"]) {
      await row(name).waitFor();
      const expand = row(name).locator(`button[aria-label="${name}フォルダを開く"]`);
      await ctx.expect(expand.or(row(name).locator(`button[aria-label="${name}フォルダを閉じる"]`))).toBeVisible();
      if (await expand.isVisible()) await expand.click();
    }
    const moved = ctx.path.join(base, "manual-destination", ctx.path.basename(editPage.relativePath));
    const original = ctx.path.join(base, editPage.relativePath);
    let reordered;
    await ctx.check("移動と並べ替えは確認なしで即時に保存され、通知の「元に戻す」で直前の構成へ戻せる。", async () => {
      await menu(editPage.title, "移動");
      await dialog.getByRole("combobox").selectOption("manual-destination");
      await button(dialog, "保存").click();
      await ctx.expect(dialog).toBeHidden();
      await ctx.fs.access(moved);
      await assert.rejects(ctx.fs.access(original));
      await button(page, "元に戻す").click();
      await ctx.expect.poll(async () => ctx.fs.access(original).then(() => true, () => false)).toBe(true);
      await menu(editPage.title, "移動");
      await dialog.getByRole("combobox").selectOption("manual-destination");
      await button(dialog, "保存").click();
      await ctx.expect(dialog).toBeHidden();
      await row("manual-acceptance").locator('button[aria-label="manual-acceptanceフォルダを閉じる"]').click();
      const orderFile = ctx.path.join(base, "_index.yaml");
      const before = await ctx.fs.readFile(orderFile, "utf8").catch(() => null);
      await row("手動受入・削除対象").dragTo(row("manual-destination"), { targetPosition: { x: 20, y: 2 } });
      await button(page, "元に戻す").waitFor();
      await ctx.expect.poll(async () => ctx.fs.readFile(orderFile, "utf8")).not.toBe(before);
      reordered = await ctx.fs.readFile(orderFile, "utf8");
      assert.notEqual(reordered, before);
      const order = parse(reordered).spec.order;
      assert(order.indexOf("manual-archive-target") >= 0 && order.indexOf("manual-archive-target") < order.indexOf("manual-destination"));
      await button(page, "元に戻す").click();
      await ctx.expect.poll(async () => ctx.fs.readFile(orderFile, "utf8").catch(() => null)).toBe(before);
      await row("手動受入・削除対象").dragTo(row("manual-destination"), { targetPosition: { x: 20, y: 2 } });
      await ctx.expect.poll(async () => ctx.fs.readFile(orderFile, "utf8").catch(() => null)).toBe(reordered);
    });
    await ctx.check("移動後もPage IDは変わらず、検索とURLから同じPageへ到達できる。", async () => {
      assert.equal(parse(await ctx.fs.readFile(moved, "utf8")).metadata.name, editPage.name);
      await page.goto(`${origin}/ja/pages/${editPage.name}/`, { waitUntil: "networkidle" });
      await ctx.expect(page.locator("#document-content")).toBeVisible();
      await button(page, "全文検索を開く").click();
      await page.getByPlaceholder("タイトルと本文を検索").fill(editPage.title);
      await page.getByRole("dialog").getByText(editPage.title, { exact: true }).first().click();
      await ctx.expect(page).toHaveURL(new RegExp(`/pages/${editPage.name}/`));
    });
    await ctx.check("Folder表示情報と順序を保存した場所だけに`_index.yaml`ができる。", async () => {
      const created = (await indexes()).filter((item) => !initialIndexes.includes(item));
      assert.deepEqual(created, ["manual-acceptance/level-2/level-3/level-4/_index.yaml", "manual-archive-target/_index.yaml", "manual-destination/_index.yaml"]);
      const folder = parse(await ctx.fs.readFile(ctx.path.join(base, "manual-archive-target/_index.yaml"), "utf8"));
      assert.equal(folder.metadata.title, "手動受入・削除対象");
    });
    await ctx.check("`spec.order`は直接の子だけを表し、画面順と一致する。", async () => {
      const order = parse(await ctx.fs.readFile(ctx.path.join(base, "_index.yaml"), "utf8")).spec.order;
      assert(Array.isArray(order));
      assert(order.every((item) => !item.includes("/")));
      assert(order.indexOf("manual-archive-target") >= 0 && order.indexOf("manual-archive-target") < order.indexOf("manual-destination"));
      const keys = await tree.locator('[role="row"][data-level="1"]').evaluateAll((rows) => rows.map((item) => item.getAttribute("data-key")));
      const displayed = keys.map((key) => key.startsWith("folder:") ? key.slice(7)
        : fixture.generated.pages.find((item) => item.name === key.slice(5))?.relativePath);
      const positions = order.map((item) => displayed.indexOf(item));
      assert(positions.every((position) => position >= 0));
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    });
    await ctx.check("アーカイブは適用の前に、対象名と配下Page数を確認する画面が出る。", async () => {
      await menu("手動受入・削除対象", "アーカイブ");
      await ctx.expect(dialog).toContainText("手動受入・削除対象");
      await ctx.expect(dialog).toContainText("影響するページ: 2件");
    });
    await ctx.check("キャンセルしたアーカイブの対象は元の場所に残る。", async () => {
      await button(dialog, "キャンセル").click();
      await ctx.expect(dialog).toBeHidden();
      await ctx.fs.access(ctx.path.join(base, "manual-archive-target"));
      for (const item of archivePages) await ctx.fs.access(ctx.path.join(base, item.relativePath));
      await ctx.expect(row("手動受入・削除対象")).toBeVisible();
    });
  } }
];
