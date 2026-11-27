import assert from "node:assert/strict";
import { parse } from "yaml";

const id = (number) => `CORE-MANUAL-A${String(number).padStart(2, "0")}`;
const button = (page, name) => page.getByRole("button", { name, exact: true });
const contentRoot = "docs";
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
async function workspace(ctx) {
  if (!ctx.state.initialized) {
    // A01〜A03 (first start, browser setup, CLI init) moved to
    // e2e/acceptance/core-setup-a.spec.ts; later steps share a CLI-made project.
    const root = await ctx.temporary("core-workspace");
    const result = ctx.cli(root, "init", "--language", "ja");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    // The new init creates only the frame (one root Page). A04 needs a nested
    // first Page (breadcrumbs) and A05 needs two hits for "目的".
    const folder = (title) => `apiVersion: vellym.tasclub.com/v1\nkind: Folder\nmetadata:\n  title: ${title}\nspec:\n  locale: ja\n  order: []\n`;
    await ctx.write(root, `${contentRoot}/acceptance/_index.yaml`, folder("受入"));
    await ctx.write(root, `${contentRoot}/acceptance/section/_index.yaml`, folder("受入の節"));
    for (const [file, name, title] of [["acceptance/guide.yaml", "acceptance-guide", "受入ガイド"], ["acceptance/section/detail.yaml", "acceptance-detail", "受入詳細"]]) {
      await ctx.write(root, `${contentRoot}/${file}`, `apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata: { name: ${name}, title: ${title} }\nspec:\n  locale: ja\n  blocks:\n    - { id: body, type: rich-text, content: "## 目的\\n\\n受入確認の本文\\n\\n## 見出し\\n\\n続きの本文" }\n`);
    }
    ctx.git(root, "init", "-q");
    ctx.git(root, "config", "user.name", "Acceptance"); ctx.git(root, "config", "user.email", "acceptance@example.invalid");
    ctx.git(root, "config", "commit.gpgSign", "false"); ctx.git(root, "add", "."); ctx.git(root, "commit", "-qm", "manual acceptance baseline");
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    const generated = await ctx.json(server.origin, "repository");
    Object.assign(ctx.state, server, { root, page, generated, initialized: true });
  }
  const { page, origin } = ctx.state;
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("treegrid", { name: "文書", exact: true }).waitFor();
  return ctx.state;
}
async function openPage(ctx, name) {
  const { page, origin } = ctx.state;
  await page.goto(`${origin}/ja/pages/${name}/`, { waitUntil: "networkidle" });
  await button(page, "編集").waitFor();
  await page.waitForLoadState("networkidle");
}
const tree = (page) => page.getByRole("treegrid", { name: "文書", exact: true });
async function create(ctx, kind, title, parent = "") {
  const { page, root } = ctx.state;
  const before = await files(ctx, ctx.path.join(root, contentRoot));
  await button(page, "新規作成").click();
  await page.getByRole("menuitem", { name: kind === "folder" ? "フォルダ" : "ページ", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: kind === "folder" ? "フォルダ名" : "ページタイトル", exact: true }).fill(title);
  const select = dialog.getByRole("combobox");
  if (await select.count()) await select.selectOption(parent);
  await ctx.expect(dialog.getByRole("textbox")).toHaveCount(1);
  assert.deepEqual(await files(ctx, ctx.path.join(root, contentRoot)), before, "Creation wrote before confirmation");
  await button(dialog, "内容を確認").click();
  await button(dialog, "この内容で作成").waitFor();
  const preview = await dialog.innerText();
  assert.deepEqual(await files(ctx, ctx.path.join(root, contentRoot)), before, "Preview wrote a file");
  await button(dialog, "この内容で作成").click();
  await ctx.expect(dialog).toBeHidden();
  if (kind === "page") {
    await ctx.check(`${title}: 作成確定直後にPage YAMLが存在（追加の保存不要）`, async () => {
      const after = await files(ctx, ctx.path.join(root, contentRoot));
      assert(Object.keys(after).some((file) => !(file in before) && parse(after[file])?.kind === "Page"), "作成確定後もPage YAMLがない");
    });
    // Current create-page opens an unsaved draft: it must not masquerade as a
    // persisted Page. The scenario's immediate-file expectation is checked below.
    if (await button(page, "保存").first().isVisible()) await button(page, "保存").first().click();
    await button(page, "編集").waitFor();
  }
  return { before, preview };
}
async function edit(ctx) {
  const { page, editPage } = ctx.state;
  if (!editPage) ctx.blocked("A06 did not create the editing Page");
  await openPage(ctx, editPage.name);
  await button(page, "編集").click();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.waitFor();
  return editor;
}
async function append(page, editor, text) {
  await editor.click();
  await editor.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.insertText(text);
  // Milkdown emits its markdown update asynchronously; leaving before that event
  // would test a harness race instead of unsaved-navigation protection.
  await page.getByText("未保存", { exact: true }).first().waitFor();
}

export const steps = [
  { id: id(4), title: "PCの階層閲覧", async run(ctx) {
    const { page, generated } = await workspace(ctx);
    const pages = generated.pages;
    await openPage(ctx, pages[0].name);
    await ctx.check("製品レール・header・ツリー・本文・アウトライン", async () => {
      await ctx.expect(page.locator("header").first()).toBeVisible();
      await ctx.expect(page.getByRole("complementary", { name: "製品", exact: true })).toBeVisible();
      await ctx.expect(tree(page)).toBeVisible();
      await ctx.expect(page.locator("#document-content")).toBeVisible();
      await ctx.expect(page.getByRole("navigation", { name: /目次|見出し/ }).first()).toBeVisible();
    });
    const folder = generated.folders.find((folder) => folder.path && pages.some((p) => p.relativePath.startsWith(`${folder.path}/`)));
    await ctx.check("Folderは直下のFolder/Pageだけの一覧", async () => {
      assert(folder);
      await tree(page).getByText(folder.title, { exact: true }).first().click();
      await ctx.expect(page.getByRole("heading", { level: 1 })).toHaveText(folder.title);
      const children = pages.filter((p) => ctx.path.posix.dirname(p.relativePath) === folder.path);
      for (const child of children) await ctx.expect(page.getByRole("button", { name: `${child.title} 文書`, exact: true })).toBeVisible();
      const deeper = pages.filter((p) => p.relativePath.startsWith(`${folder.path}/`) && !children.includes(p));
      for (const child of deeper) await ctx.expect(page.locator("main").getByRole("button", { name: `${child.title} 文書`, exact: true })).toHaveCount(0);
    });
    await openPage(ctx, pages[0].name);
    await ctx.check("パンくず・本文・前後文書がPageに対応", async () => {
      await ctx.expect(page.getByRole("heading", { level: 1 })).toHaveText(pages[0].title);
      await ctx.expect(page.getByRole("navigation", { name: "パンくず" })).toBeVisible();
      const nav = page.getByRole("navigation", { name: "前後の文書" });
      await ctx.expect(nav).toBeVisible();
      const link = nav.getByRole("button").first();
      const title = await link.innerText();
      await link.click();
      await ctx.expect.poll(async () => title.includes(await page.getByRole("heading", { level: 1 }).innerText())).toBe(true);
    });
    await ctx.check("通常画面にYAML名・相対path・Page/block IDを露出しない", async () => {
      const text = await page.locator("body").innerText();
      const displayedTitle = await page.getByRole("heading", { level: 1 }).innerText();
      const current = generated.pages.find((p) => p.title === displayedTitle);
      assert(current);
      assert(!text.includes(current.relativePath));
      assert(!text.includes(ctx.path.basename(current.relativePath)));
      assert(!text.includes(current.name));
      const data = await ctx.json(ctx.state.origin, `pages/${current.name}`);
      for (const block of data.knownBlocks ?? []) if (block.id && block.id !== current.title) assert(!new RegExp(`\\b${block.id}\\b`).test(text));
    });
    await ctx.check("ツリー開閉とpointer幅変更、再読み込みで状態保持", async () => {
      await button(page, "文書ナビゲーションを閉じる").click();
      await ctx.expect(tree(page)).toBeHidden();
      await page.reload();
      await ctx.expect(tree(page)).toBeHidden();
      await button(page, "文書ナビゲーションを開く").click();
      const separator = page.getByRole("separator", { name: "文書ナビゲーションの幅" });
      const before = Number(await separator.getAttribute("aria-valuenow"));
      const box = await separator.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 10 }); await page.mouse.up();
      const after = await separator.getAttribute("aria-valuenow");
      assert(Number(after) > before);
      await page.reload();
      await ctx.expect(separator).toHaveAttribute("aria-valuenow", after);
      await ctx.expect(tree(page)).toBeVisible();
    });
    await ctx.check("戻る・進むでPageと見出し位置が復元", async () => {
      await openPage(ctx, pages[0].name);
      const headingLink = page.locator("nav ol li > a").last();
      await headingLink.click();
      const first = page.url();
      await page.getByRole("navigation", { name: "前後の文書" }).getByRole("button").first().click();
      const second = page.url();
      await page.goBack(); await ctx.expect(page).toHaveURL(first);
      const target = page.locator(`[id="${decodeURIComponent(new URL(first).hash.slice(1))}"]`);
      await ctx.expect(target).toBeInViewport();
      await page.goForward(); await ctx.expect(page).toHaveURL(second);
    });
  } },
  { id: id(5), title: "全文検索と見出し移動", async run(ctx) {
    const { page, generated } = await workspace(ctx);
    await openPage(ctx, generated.pages[0].name);
    const start = page.url();
    await button(page, "全文検索を開く").click();
    const dialog = page.getByRole("dialog");
    const input = page.getByRole("textbox", { name: "文書を検索" });
    await ctx.check("query未入力・0件・複数件", async () => {
      await ctx.expect(input).toHaveValue("");
      await ctx.expect(dialog.getByRole("option")).toHaveCount(0);
      await input.fill("unfindable-acceptance-92814");
      await ctx.expect(dialog.getByText(/見つかりません|0件|ありません/).first()).toBeVisible();
      await input.fill("目的");
      await ctx.expect.poll(() => dialog.getByRole("option").count()).toBeGreaterThan(1);
    });
    await ctx.check("結果にtitle・階層・見出し・抜粋", async () => {
      const option = dialog.getByRole("option").first();
      const text = await option.innerText();
      assert(generated.pages.some((p) => text.includes(p.title)));
      assert(text.includes("目的"));
      assert(text.split("\n").filter(Boolean).length >= 3, text);
    });
    await ctx.check("上下矢印・Enterで選択、Pageと見出しへ移動してfocus", async () => {
      await input.press("ArrowDown");
      await ctx.expect(dialog.getByRole("option").first()).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await ctx.expect(dialog.getByRole("option").nth(1)).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await ctx.expect(dialog.getByRole("option").first()).toBeFocused();
      await page.keyboard.press("Enter");
      await ctx.expect(dialog).toBeHidden();
      await ctx.expect.poll(() => new URL(page.url()).hash).not.toBe("");
      const hash = decodeURIComponent(new URL(page.url()).hash.slice(1));
      await ctx.expect(page.locator(`[id="${hash}"]`)).toBeFocused();
    });
    await ctx.check("戻ると元Page、Escapeで検索を閉じる", async () => {
      await page.goBack(); await ctx.expect(page).toHaveURL(start);
      await button(page, "全文検索を開く").click();
      await input.press("Escape"); await ctx.expect(dialog).toBeHidden();
    });
    await ctx.check("outline見出し選択とリンクコピー", async () => {
      const link = page.locator("nav ol li > a").last();
      await link.click();
      const url = page.url();
      await page.getByRole("button", { name: /見出し.*リンク.*コピー|リンク.*コピー/ }).first().click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
    });
  } },
  { id: id(6), title: "深いFolderと編集対象Pageを作成", async run(ctx) {
    const { page, root, origin } = await workspace(ctx);
    let parent = "";
    for (const title of ["manual-acceptance", "level-2", "level-3", "level-4"]) {
      await ctx.check(`Folder ${parent}/${title}: ID不要・確定前無変更・即時ツリー反映`, async () => {
        await create(ctx, "folder", title, parent);
        await button(page, "すべて展開").click();
        await ctx.expect(tree(page).getByText(title, { exact: true })).toBeVisible();
        await ctx.fs.access(ctx.path.join(root, contentRoot, parent, title));
      });
      parent = [parent, title].filter(Boolean).join("/");
    }
    for (const title of ["manual-destination", "manual-archive-target"]) {
      await ctx.check(`Folder ${title}を作成`, () => create(ctx, "folder", title));
    }
    for (const [title, destination] of [["Core受入・編集対象", parent], ["削除確認1", "manual-archive-target"], ["削除確認2", "manual-archive-target"]]) {
      await ctx.check(`Page ${title}: ID不要・確定前無変更・保存・ツリーとFolder一覧反映`, async () => {
        await create(ctx, "page", title, destination);
        const repository = await ctx.json(origin, "repository");
        const created = repository.pages.find((p) => p.title === title);
        assert(created);
        if (title === "Core受入・編集対象") ctx.state.editPage = created;
        assert.equal(ctx.path.posix.dirname(created.relativePath), destination);
        await button(page, "すべて展開").click();
        await ctx.expect(tree(page).getByText(title, { exact: true })).toBeVisible();
        await tree(page).getByText(destination.split("/").pop(), { exact: true }).click();
        await ctx.expect(page.getByRole("button", { name: `${title} 文書`, exact: true })).toBeVisible();
      });
    }
    await ctx.check("4階層の展開・折り畳み・keyboard移動", async () => {
      await button(page, "すべて展開").click();
      const row = tree(page).getByRole("row").filter({ has: page.getByText("level-4", { exact: true }) });
      await ctx.expect(row).toHaveAttribute("aria-level", "4");
      await row.focus(); await page.keyboard.press("ArrowLeft");
      await ctx.expect(row).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press("ArrowRight"); await ctx.expect(row).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("ArrowDown"); await ctx.expect(row).not.toBeFocused();
    });
    await ctx.check("同名Pageは既存無変更で別候補path", async () => {
      const existing = ctx.state.editPage;
      assert(existing);
      const source = await ctx.fs.readFile(ctx.path.join(root, contentRoot, existing.relativePath), "utf8");
      const { preview } = await create(ctx, "page", "Core受入・編集対象", parent);
      assert(!preview.includes(`${contentRoot}/${existing.relativePath}`));
      assert.equal(await ctx.fs.readFile(ctx.path.join(root, contentRoot, existing.relativePath), "utf8"), source);
      const repository = await ctx.json(origin, "repository");
      const duplicates = repository.pages.filter((p) => p.title === "Core受入・編集対象");
      assert.equal(duplicates.length, 2);
      assert.notEqual(duplicates[0].relativePath, duplicates[1].relativePath);
    });
    await ctx.check("物理Folder/Page YAMLとvalidate・git status", async () => {
      const all = await files(ctx, ctx.path.join(root, contentRoot));
      assert(Object.keys(all).some((file) => file.startsWith(`${parent}/`) && parse(all[file]).kind === "Page"));
      const result = ctx.cli(root, "validate"); assert.equal(result.status, 0, result.stdout + result.stderr);
      ctx.note(`CLI validate: ${result.stdout}; files: ${Object.keys(all).join(", ")}`);
      assert(ctx.git(root, "status", "--short"));
    });
  } },
  { id: id(7), title: "日本語編集とYAML保存", async run(ctx) {
    await workspace(ctx);
    const { page, root, editPage } = ctx.state;
    const editor = await edit(ctx);
    const file = ctx.path.join(root, contentRoot, editPage.relativePath);
    const before = parse(await ctx.fs.readFile(file, "utf8"));
    await ctx.check("同一Pageで閲覧と編集切替、常設previewなし、入力後未保存", async () => {
      assert(page.url().includes(`/pages/${editPage.name}/`));
      await ctx.expect(page.locator('[class*="preview-pane"]')).toHaveCount(0);
      await page.getByRole("textbox", { name: "ページタイトル", exact: true }).fill("Core受入・編集対象 更新後");
      await ctx.expect(page.getByText("未保存", { exact: true }).first()).toBeVisible();
    });
    await ctx.check("IME変換中に保存・focus移動・重複なし", async () => {
      await editor.focus();
      await editor.dispatchEvent("compositionstart", { data: "" });
      await editor.dispatchEvent("compositionupdate", { data: "日本語変換" });
      await editor.dispatchEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, isComposing: true, keyCode: 229 });
      await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
      await page.waitForTimeout(300);
      await ctx.expect(editor).toBeFocused();
      assert.deepEqual(parse(await ctx.fs.readFile(file, "utf8")), before);
      await editor.dispatchEvent("compositionend", { data: "" });
      await page.keyboard.insertText("日本語変換");
      assert.equal((await editor.innerText()).split("日本語変換").length - 1, 1);
    });
    ctx.note("自動化できない部分: macOSの実機IMEの候補表示・候補選択。compositionイベントと確定文字入力で変換中の保護のみ確認する。");
    await ctx.check("toolbarとkeyboardで書式、見出し・段落・強調・箇条書き・リンク・引用・code block", async () => {
      // Keyboard markdown input exercises actual editor input rules, not an API patch.
      await editor.focus(); await page.keyboard.press("Control+End"); await page.keyboard.press("Enter");
      await button(page, "見出し2").click(); await page.keyboard.insertText("受入見出し"); await page.keyboard.press("Enter");
      await page.keyboard.press("Control+b"); await page.keyboard.insertText("受入太字"); await page.keyboard.press("Control+b"); await page.keyboard.press("Enter");
      await button(page, "箇条書き").click(); await page.keyboard.insertText("受入項目"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
      await page.keyboard.type("> "); await page.keyboard.insertText("受入引用"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
      // Paste CommonMark as text: the editor preserves text; link/code formatting
      // is then applied through the toolbar, as the scenario requires.
      await page.keyboard.insertText("受入段落");
      await page.keyboard.press("Shift+Home");
      await button(page, "リンク").click();
      const linkDialog = page.getByRole("dialog");
      await linkDialog.getByRole("textbox", { name: "リンク先URL" }).fill("https://example.com/acceptance");
      await button(linkDialog, "挿入").click();
      await ctx.expect(editor.locator('a[href="https://example.com/acceptance"]')).toContainText("受入段落");
      await editor.focus(); await page.keyboard.press("Control+End"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
      await page.locator('summary[aria-label="その他の書式"]').click();
      await button(page, "コードブロック").click(); await page.keyboard.insertText("acceptance-code");
      await ctx.expect(editor.locator("h2")).toContainText("受入見出し");
      await ctx.expect(editor.locator("strong")).toContainText("受入太字");
      await ctx.expect(editor.locator("li")).toContainText("受入項目");
      await ctx.expect(editor.locator("blockquote")).toContainText("受入引用");
      await ctx.expect(editor.locator("pre")).toContainText("acceptance-code");
    });
    await ctx.check("複数行日本語clipboard貼付、undo一回とredo", async () => {
      await editor.focus(); await page.keyboard.press("Control+End");
      await page.evaluate(() => navigator.clipboard.writeText("貼付日本語一行目\n貼付日本語二行目"));
      await page.keyboard.press("Control+V");
      await ctx.expect(editor).toContainText("貼付日本語二行目");
      await button(page, "元に戻す").click(); await ctx.expect(editor).not.toContainText("貼付日本語二行目");
      await ctx.expect(editor).toContainText("日本語変換");
      await button(page, "やり直す").click(); await ctx.expect(editor).toContainText("貼付日本語二行目");
    });
    await ctx.check("保存中・成功・保存済みを区別、閲覧へ戻り再読込で維持", async () => {
      // Match a human pause after redo; Milkdown's markdown listener is debounced.
      await page.waitForTimeout(300);
      // Delay only the real save response so the transient saving state is observable.
      await page.route("**/api/v1/pages/**", async (route) => {
        if (["PATCH", "PUT", "POST"].includes(route.request().method())) await new Promise((resolve) => setTimeout(resolve, 300));
        await route.continue();
      });
      await button(page, "保存").first().click();
      await ctx.expect(page.getByText("保存中", { exact: true }).first()).toBeVisible();
      await ctx.expect(page.getByText(/YAMLへ保存しました/).first()).toBeVisible();
      await button(page, "編集").waitFor();
      const text = await page.locator("article.document section[data-block-id]").allTextContents();
      assert(text.join("\n").includes("貼付日本語二行目"), "Saved body lost edited text");
      await page.reload(); await button(page, "編集").waitFor();
      assert.deepEqual(await page.locator("article.document section[data-block-id]").allTextContents(), text);
      await page.unroute("**/api/v1/pages/**");
    });
    await ctx.check("YAMLはtitle/rich-text以外を保持、ファイル名・Page/block ID不変、validate成功", async () => {
      const after = parse(await ctx.fs.readFile(file, "utf8"));
      const artifact = "CORE-MANUAL-A07-yaml.json";
      await ctx.fs.writeFile(ctx.path.join(ctx.output, artifact), JSON.stringify({ relativePath: editPage.relativePath, before, after }, null, 2));
      ctx.note(`YAML evidence: ${artifact}`);
      assert.equal(after.metadata.title, "Core受入・編集対象 更新後");
      const markdown = after.spec.blocks.filter((b) => b.type === "rich-text").map((b) => b.content).join("\n");
      for (const expected of ["## 受入見出し", "**受入太字**", "受入項目", "> 受入引用", "https://example.com/acceptance", "```", "acceptance-code", "貼付日本語二行目"]) assert(markdown.includes(expected), `保存YAMLに${expected}がない`);
      const normalized = structuredClone(after);
      normalized.metadata.title = before.metadata.title;
      for (const block of normalized.spec.blocks) {
        const original = before.spec.blocks.find((b) => b.id === block.id);
        assert(original);
        if (block.type === "rich-text") block.content = original.content;
      }
      assert.deepEqual(normalized, before);
      const result = ctx.cli(root, "validate"); assert.equal(result.status, 0, result.stdout + result.stderr);
      ctx.note(ctx.git(root, "diff", "--", file));
    });
  } },
  { id: id(8), title: "キャンセルと未保存離脱保護", async run(ctx) {
    await workspace(ctx);
    const { page, root, editPage, generated } = ctx.state;
    const file = editPage && ctx.path.join(root, contentRoot, editPage.relativePath);
    if (!file) ctx.blocked("A06 editing Page unavailable");
    const saved = await ctx.fs.readFile(file, "utf8");
    let editor = await edit(ctx);
    const marker = "保存してはいけない一時入力";
    await append(page, editor, marker);
    await ctx.check("キャンセル→編集を続けるで入力とfocus保持", async () => {
      await button(page, "キャンセル").first().click();
      await page.getByRole("heading", { name: "未保存の変更があります" }).waitFor();
      await button(page, "編集を続ける").click();
      await ctx.expect(editor).toContainText(marker);
      await ctx.check("キャンセル継続後のfocus", () => ctx.expect(editor).toBeFocused());
    });
    await ctx.check("再キャンセル→破棄だけが一時入力を捨て保存済みへ戻る", async () => {
      await button(page, "キャンセル").first().click(); await button(page, "変更を破棄").click();
      await button(page, "編集").waitFor();
      await ctx.expect(page.locator("#document-content")).not.toContainText(marker);
      assert.equal(await ctx.fs.readFile(file, "utf8"), saved);
    });
    const other = generated.pages.find((p) => p.name !== editPage.name);
    const destinations = [
      ["別Page", () => tree(page).getByText(other.title, { exact: true }).first().click()],
      ["別Folder", () => tree(page).getByText("manual-destination", { exact: true }).click()],
      ["設定", () => page.getByRole("button", { name: /^設定/ }).first().click()]
    ];
    for (const [title, navigate] of destinations) await ctx.check(`${title}: 確認→継続で入力focus保持、破棄でのみ移動`, async () => {
      editor = await edit(ctx); await append(page, editor, marker);
      const url = page.url(); await navigate();
      await page.getByRole("heading", { name: "未保存の変更があります" }).waitFor();
      assert.equal(page.url(), url);
      await button(page, "編集を続ける").click();
      await ctx.expect(editor).toContainText(marker);
      await ctx.check(`${title}移動継続後のfocus`, () => ctx.expect(editor).toBeFocused());
      await navigate(); await button(page, "変更を破棄").click();
      await ctx.expect(editor).toBeHidden();
      if (title === "設定") await ctx.expect(page.getByRole("heading", { name: "設定・管理詳細" })).toBeVisible();
      else if (title === "別Folder") await ctx.expect(page.getByRole("heading", { level: 1 })).toHaveText("manual-destination");
      else await ctx.expect(page).not.toHaveURL(url);
      assert.equal(await ctx.fs.readFile(file, "utf8"), saved);
    });
    for (const action of ["reload", "close"]) await ctx.check(`ブラウザ${action}: 標準離脱警告、拒否で入力保持`, async () => {
      editor = await edit(ctx); await append(page, editor, marker);
      const dialog = page.waitForEvent("dialog");
      const operation = action === "reload" ? page.reload().catch(() => {}) : page.close({ runBeforeUnload: true });
      const prompt = await dialog;
      assert.equal(prompt.type(), "beforeunload"); await prompt.dismiss(); await operation;
      assert(!page.isClosed()); await ctx.expect(editor).toContainText(marker);
    });
    assert.equal(await ctx.fs.readFile(file, "utf8"), saved);
    // Leave the fixture clean for later scenario modules.
    if (await button(page, "キャンセル").first().isVisible()) {
      await button(page, "キャンセル").first().click(); await button(page, "変更を破棄").click();
    }
  } }
];
