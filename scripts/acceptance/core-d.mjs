import assert from "node:assert/strict";
import { createCoreWorkspace } from "./lib/core-fixture.mjs";

const button = (page, name) => page.getByRole("button", { name, exact: true });
async function workspace(ctx) {
  ctx.state.core ??= await createCoreWorkspace(ctx);
  // The runner uses state.page for failure screenshots.
  ctx.state.page = ctx.state.core.page;
  return ctx.state.core;
}
async function openPage(ctx, fixture) {
  await fixture.page.goto(`${fixture.origin}/ja/pages/${fixture.editPage.name}/`, { waitUntil: "networkidle" });
  await ctx.expect(fixture.page.locator("#document-content")).toContainText("受入確認の本文");
}
async function search(ctx, page, query, title, present = true) {
  await button(page, "全文検索を開く").click();
  const dialog = page.getByRole("dialog");
  await page.getByPlaceholder("タイトルと本文を検索").fill(query);
  if (present) await ctx.expect(dialog.getByText(title, { exact: true }).first()).toBeVisible();
  else {
    // Wait for the completed search, not the initially empty result list.
    await ctx.expect(dialog.getByText(/0件/).first()).toBeVisible();
    await ctx.expect(dialog.getByText(title, { exact: true })).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
}
async function editOther(ctx, fixture, marker) {
  await openPage(ctx, fixture);
  await button(fixture.page, "編集").click();
  const editor = fixture.page.locator('[contenteditable="true"]').first();
  await editor.click();
  await fixture.page.keyboard.press("Control+End");
  await fixture.page.keyboard.insertText(marker);
  await button(fixture.page, "保存").first().click();
  await button(fixture.page, "編集").waitFor();
  assert((await ctx.fs.readFile(ctx.path.join(fixture.root, fixture.contentRoot, fixture.editPage.relativePath), "utf8")).includes(marker));
}
async function sources(ctx, fixture) {
  const base = ctx.path.join(fixture.root, fixture.contentRoot);
  const entries = await ctx.fs.readdir(base, { recursive: true, withFileTypes: true });
  const result = {};
  for (const entry of entries.filter((item) => item.isFile() && /\.ya?ml$/.test(item.name))) {
    const file = ctx.path.join(entry.parentPath, entry.name);
    result[ctx.path.relative(base, file)] = await ctx.fs.readFile(file, "utf8");
  }
  return result;
}

export const steps = [
  { id: "CORE-MANUAL-A12", title: "Folderを削除し、画面とCLIで同じ結果を確認する", async run(ctx) {
    const fixture = await workspace(ctx);
    const { page, root, contentRoot, origin, archivePages } = fixture;
    await page.goto(origin, { waitUntil: "networkidle" });
    const tree = page.getByRole("treegrid", { name: "文書", exact: true });
    await button(tree, "manual-archive-targetの操作").click();
    await page.getByRole("menuitem", { name: "表示情報を編集", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "表示名", exact: true }).fill("手動受入・削除対象");
    await dialog.getByRole("textbox", { name: "説明（任意）", exact: true }).fill("配下をまとめてアーカイブする試験Folder");
    await button(dialog, "保存").click();
    await ctx.expect(dialog).toBeHidden();
    const before = await sources(ctx, fixture);
    ctx.git(root, "add", ".");
    ctx.git(root, "commit", "-qm", "A12 pre-archive fixture");
    const head = ctx.git(root, "rev-parse", "HEAD");
    const initial = JSON.parse(ctx.cli(root, "validate", "--json").stdout).data;
    await button(tree, "手動受入・削除対象の操作").click();
    await page.getByRole("menuitem", { name: "アーカイブ", exact: true }).click();
    // Every preview item is asserted before the destructive-looking action.
    const previewOK = [];
    previewOK.push(await ctx.check("sourceと`_archive/`以下のdestination", async () => {
      await ctx.expect(dialog).toContainText("manual-archive-target");
      await ctx.expect(dialog).toContainText("_archive/manual-archive-target");
    }));
    previewOK.push(await ctx.check("配下の影響Page数が2件であること", () => ctx.expect(dialog).toContainText("影響するページ: 2件")));
    previewOK.push(await ctx.check("空でないFolderの内容も一緒に移動する警告", () => ctx.expect(dialog).toContainText("空でないフォルダです。配下の内容も一緒にアーカイブします")));
    previewOK.push(await ctx.check("アーカイブした後の戻し方（設定の「アーカイブ済み」から復元できる）", () => ctx.expect(dialog).toContainText("アーカイブ後は設定画面の「アーカイブ済み」から復元できます。")));
    if (previewOK.some((ok) => !ok)) ctx.note("previewの不足をFAILとして記録した上で、使い捨てfixtureに適用して残りの確認を継続する。");
    await button(dialog, "アーカイブ").click();
    await ctx.expect(dialog).toBeHidden();
    await ctx.check("Folderと「削除確認1」「削除確認2」がツリーとFolder一覧から消える。", async () => {
      await ctx.expect(button(tree, "手動受入・削除対象の操作")).toHaveCount(0);
      for (const item of archivePages) await ctx.expect(tree.getByText(item.title, { exact: true })).toHaveCount(0);
      await openPage(ctx, fixture);
      await page.getByRole("navigation", { name: "パンくず" }).getByRole("button", { name: "すべての文書", exact: true }).click();
      await ctx.expect(page.locator("#document-content")).not.toContainText("手動受入・削除対象");
      for (const item of archivePages) await ctx.expect(page.locator("#document-content")).not.toContainText(item.title);
    });
    await ctx.check("全文検索でも2 Pageが通常結果に出ない。", async () => {
      for (const item of archivePages) await search(ctx, page, "削除確認", item.title, false);
    });
    await ctx.check("他のPageは閲覧、検索、編集できる。", async () => {
      await openPage(ctx, fixture);
      await search(ctx, page, fixture.editPage.title, fixture.editPage.title);
      await editOther(ctx, fixture, "A12アーカイブ後の編集");
    });
    await ctx.check("読み込み問題として誤表示されない。", async () => {
      await button(page, "設定").click();
      await ctx.expect(page.getByRole("region", { name: "読み込みの問題" })).toContainText("読み込めない文書はありません。");
    });
    const base = ctx.path.join(root, contentRoot);
    await ctx.check("元Folderは存在せず、Folder全体が`_archive/`へ移動している。", async () => {
      await assert.rejects(ctx.fs.access(ctx.path.join(base, "manual-archive-target")));
      assert((await ctx.fs.stat(ctx.path.join(base, "_archive/manual-archive-target"))).isDirectory());
    });
    await ctx.check("2 PageとFolder metadataが`_archive/`内に残り、実削除されていない。", async () => {
      for (const relative of [...archivePages.map((item) => item.relativePath), "manual-archive-target/_index.yaml"]) {
        assert.equal(await ctx.fs.readFile(ctx.path.join(base, "_archive", relative), "utf8"), before[relative]);
      }
    });
    await ctx.check("`validate`はアーカイブを通常Pageへ数えず、残ったPageは診断0件である。", async () => {
      const result = ctx.cli(root, "validate", "--json");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const data = JSON.parse(result.stdout).data;
      assert.equal(data.pages.length, initial.pages.length - 2);
      assert.equal(JSON.parse(result.stdout).diagnostics.length, 0);
      for (const item of archivePages) assert(!data.pages.some((p) => p.name === item.name));
    });
    await ctx.check("Gitは削除と追加／rename相当の作業ツリー差分を示すが、Vellymはcommitしていない。", async () => {
      const status = ctx.git(root, "status", "--short");
      assert.match(status, / D .*manual-archive-target/);
      assert.match(status, /\?\? .*_archive\//);
      assert.equal(ctx.git(root, "rev-parse", "HEAD"), head);
      ctx.note(status);
    });
  } },
  { id: "CORE-MANUAL-A13", title: "読み込めない単一YAMLを隔離する", async run(ctx) {
    const fixture = await workspace(ctx);
    const { page, root, contentRoot } = fixture;
    await openPage(ctx, fixture);
    const before = await sources(ctx, fixture);
    const file = ctx.path.join(root, contentRoot, "manual-broken.yaml");
    await ctx.fs.writeFile(file, "apiVersion: vellym.tasclub.com/v1alpha1\nkind: Page\nmetadata: [\n");
    let diagnostic;
    try {
      await ctx.check("CLIは該当file、原因、診断codeを出し、exit code 1になる。", async () => {
        const result = ctx.cli(root, "validate", "--json");
        assert.equal(result.status, 1, result.stdout + result.stderr);
        diagnostic = JSON.parse(result.stdout).diagnostics.find((item) => item.file.endsWith("manual-broken.yaml"));
        assert(diagnostic?.code);
        assert(diagnostic.message);
        ctx.note(JSON.stringify(diagnostic));
      });
      await ctx.check("画面全体は停止せず、有効な他Pageを閲覧・検索できる。", async () => {
        await openPage(ctx, fixture);
        await search(ctx, page, fixture.editPage.title, fixture.editPage.title);
      });
      await ctx.check("設定レールに問題件数が分かる表示が出る。", async () => {
        await ctx.expect(page.getByRole("button", { name: /設定.*読み込みの問題1件/ })).toBeVisible({ timeout: 15000 });
      });
      await ctx.check("通常の文書画面へ技術的な診断一覧を常設しない。", async () => {
        await ctx.expect(page.getByRole("region", { name: "読み込みの問題" })).toHaveCount(0);
        await ctx.expect(page.getByText("manual-broken.yaml", { exact: false })).toHaveCount(0);
      });
      await page.getByRole("button", { name: /^設定/ }).click();
      await ctx.check("設定・管理詳細の「読み込みの問題」に`manual-broken.yaml`、原因、code、pathが出る。", async () => {
        const problems = page.getByRole("region", { name: "読み込みの問題" });
        await ctx.expect(problems).toContainText("manual-broken.yaml");
        assert(diagnostic, "CLI diagnostic required");
        await ctx.expect(problems).toContainText(diagnostic.code);
        const message = typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.ja;
        await ctx.expect(problems).toContainText(message);
        if (diagnostic.path) await ctx.expect(problems).toContainText(diagnostic.path);
      });
    } finally {
      await ctx.fs.unlink(file);
    }
    await ctx.check("問題が0件になり、有効Pageと既存YAMLが変わっていないことを確認する。", async () => {
      // The watcher must clear the diagnostic without a manual recheck action.
      await ctx.expect(page.getByRole("region", { name: "読み込みの問題" })).toContainText("読み込めない文書はありません。", { timeout: 15000 });
      assert.equal(ctx.cli(root, "validate").status, 0);
      assert.deepEqual(await sources(ctx, fixture), before);
      ctx.note("fixture除去後、watcherによる問題0件・CLI成功・既存YAML完全一致を確認済み。");
      await openPage(ctx, fixture);
    });
  } },
  { id: "CORE-MANUAL-A14", title: "未対応blockを非破壊に扱う", async run(ctx) {
    const fixture = await workspace(ctx);
    const { page, root, contentRoot, origin } = fixture;
    const source = "apiVersion: vellym.tasclub.com/v1alpha1\nkind: Page\nmetadata:\n  name: manual-unsupported\n  title: 未対応block保持確認\nspec:\n  blocks:\n    - id: body\n      type: rich-text\n      format: commonmark\n      content: |\n        ## 表示できる本文\n\n        この本文は閲覧できる。\n    - id: future\n      type: future-widget\n      value: keep-this-exact-value\n";
    const file = ctx.path.join(root, contentRoot, "manual-unsupported.yaml");
    await ctx.fs.writeFile(file, source);
    const validation = ctx.cli(root, "validate");
    ctx.note(`validate exit=${validation.status}\n${validation.stdout}${validation.stderr}`);
    const url = `${origin}/ja/pages/manual-unsupported/`;
    await page.goto(url, { waitUntil: "networkidle" });
    await ctx.check("Page自体と既知rich-textは閲覧できる。", async () => {
      await ctx.expect(page.getByRole("heading", { name: "未対応block保持確認", exact: true })).toBeVisible();
      await ctx.expect(page.locator("#document-content")).toContainText("この本文は閲覧できる。");
    });
    await ctx.check("未対応blockがある理由を示して編集を許可しない。", async () => {
      await ctx.expect(page.getByText("この文書には、この版で表示できない内容があります。")).toBeVisible();
      const edit = button(page, "編集");
      if (await edit.count() && await edit.isEnabled()) {
        const response = page.waitForResponse((res) => res.url().endsWith("/pages/manual-unsupported/edit"));
        await edit.click();
        const data = (await (await response).json()).data;
        assert.equal(data.readOnly, true, "編集APIが未対応blockを編集可能としている");
        await ctx.expect(page.getByRole("alert")).toBeVisible();
      }
      await ctx.expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    });
    await page.reload({ waitUntil: "networkidle" });
    await ctx.check("他Pageの編集と保存は継続できる。", () => editOther(ctx, fixture, "A14未対応block存在時の編集"));
    await ctx.check("再読み込みや他Pageの保存後も`future-widget`と`keep-this-exact-value`が原文のまま残る。", async () => {
      await page.goto(url, { waitUntil: "networkidle" });
      await ctx.expect(page.locator("#document-content")).toContainText("この本文は閲覧できる。");
      assert.equal(await ctx.fs.readFile(file, "utf8"), source);
    });
  } }
];
