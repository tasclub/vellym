// Ticket management manual acceptance, sections C and C2 (definitions vs. data, several trackers).
// ticket-01m7p97tp8htrtkdv8z2dxs6xq.
import assert from "node:assert/strict";

const id = (suffix) => `TICKET-MANUAL-C${suffix}`;
const button = (page, name) => page.getByRole("button", { name, exact: true });
const tracker = (name, title, statuses, fields = "") => `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: ${name}, title: ${title} }
spec:
  statuses:
${statuses.map(([status, label, category]) => `    - { id: ${status}, label: ${label}, category: ${category} }`).join("\n")}
  fields:${fields || " []"}
`;
const ticket = (name, title, status, fields = "{ priority: high }", extra = "") => `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata: { name: ${name}, title: ${title} }
spec:
${status === undefined ? "" : `  status: ${status}\n`}  fields: ${fields}
${extra}  blocks:
    - { id: body, type: rich-text, content: "${title}の本文" }
`;
const DEV_FIELDS = "\n    - { id: priority, label: 優先度, type: select, required: true, listColumn: true, options: [{ value: high, label: 高 }, { value: low, label: 低 }] }";
const QA_FIELDS = "\n    - { id: severity, label: 重大度, type: select, listColumn: true, options: [{ value: s1, label: 致命 }, { value: s2, label: 軽微 }] }";

/** Two trackers in separate folders, a nested tracker, untracked and hidden tickets, and a linking page. */
async function workspace(ctx) {
  if (ctx.state.ticketC) return ctx.state.ticketC;
  const root = await ctx.temporary("ticket-c");
  await ctx.fs.mkdir(ctx.path.join(root, "node_modules"), { recursive: true });
  await ctx.fs.symlink(ctx.path.join(ctx.repository, "node_modules/@vellym"), ctx.path.join(root, "node_modules/@vellym"), "dir");
  await ctx.write(root, ".gitignore", "node_modules\ndist\n");
  await ctx.write(root, "vellym.config.yaml", 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist/site\nui:\n  language: ja\ni18n:\n  defaultLocale: ja\nplugins:\n  - "@vellym/tickets"\n');
  await ctx.write(root, "content/dev/tracker.yaml", tracker("dev-tracker", "開発の作業", [["open", "未着手", "open"], ["done", "完了", "closed"]], DEV_FIELDS));
  await ctx.write(root, "content/dev/+tickets/ticket-01accc000000000000000dev1.yaml", ticket("ticket-01accc000000000000000dev1", "開発の作業1", "open"));
  await ctx.write(root, "content/dev/+tickets/ticket-01accc000000000000000dev2.yaml", ticket("ticket-01accc000000000000000dev2", "定義外の状態", "mystery"));
  await ctx.write(root, "content/dev/+tickets/ticket-01accc000000000000000dev3.yaml", ticket("ticket-01accc000000000000000dev3", "定義外の項目", "open", "{ unknownField: 残す値 }"));
  await ctx.write(root, "content/dev/ui/tracker.yaml", tracker("ui-tracker", "画面の作業", [["open", "未着手", "open"], ["review", "確認中", "open"], ["done", "完了", "closed"]], DEV_FIELDS));
  await ctx.write(root, "content/dev/ui/+tickets/ticket-01accc0000000000000000ui1.yaml", ticket("ticket-01accc0000000000000000ui1", "画面の作業1", "review"));
  await ctx.write(root, "content/dev/by-area/api/ticket-01accc000000000000000api1.yaml", ticket("ticket-01accc000000000000000api1", "分類したAPIの作業", "open"));
  await ctx.write(root, "content/dev/by-area/web/ticket-01accc000000000000000web1.yaml", ticket("ticket-01accc000000000000000web1", "分類した画面の作業", "open"));
  await ctx.write(root, "content/qa/tracker.yaml", tracker("qa-tracker", "品質の作業", [["triage", "調査中", "open"], ["closed", "終了", "closed"]], QA_FIELDS));
  await ctx.write(root, "content/qa/+tickets/ticket-01accc0000000000000000qa1.yaml", ticket("ticket-01accc0000000000000000qa1", "品質の作業1", "triage", "{ severity: s1 }"));
  await ctx.write(root, "content/notes/ticket-01accc00000000000000orph1.yaml", ticket("ticket-01accc00000000000000orph1", "どこにも属さない", "open"));
  await ctx.write(root, "content/guide.yaml", "apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata: { name: guide, title: 案内 }\nspec:\n  locale: ja\n  blocks:\n    - { id: body, type: rich-text, content: \"[[ticket-01accc00000000000000orph1]]と[[ticket-01accc00000000000000hid1]]を見る。\" }\n");
  ctx.git(root, "init", "-q");
  ctx.git(root, "config", "user.name", "Acceptance");
  ctx.git(root, "config", "user.email", "acceptance@example.invalid");
  ctx.git(root, "config", "commit.gpgSign", "false");
  ctx.git(root, "add", ".");
  ctx.git(root, "commit", "-qm", "baseline");
  const server = await ctx.start(root);
  const page = await ctx.page(server.origin);
  ctx.state.page = page;
  ctx.state.ticketC = { root, server, page };
  return ctx.state.ticketC;
}
const listText = async (ctx, page, origin, trackerName) => {
  await page.goto(`${origin}/ja/pages/${trackerName}/`, { waitUntil: "networkidle" });
  await button(page, "チケット一覧").click();
  const toggle = page.locator("xpath=//button[starts-with(normalize-space(.), '絞り込み')]/preceding-sibling::button[1]");
  const table = page.getByRole("table").first();
  await table.waitFor();
  if ((await toggle.getAttribute("aria-pressed")) !== "false") await toggle.click();
  await page.waitForTimeout(300);
  return { text: await table.innerText(), headers: (await table.locator("thead th").allInnerTexts()).map((text) => text.replace(/[↑↓]/g, "").trim()).filter(Boolean) };
};
const diagnostics = (ctx, root) => JSON.parse(ctx.cli(root, "validate", "--json").stdout).diagnostics;
const validate = (ctx, root) => ctx.cli(root, "validate", "--json");
const settle = (page) => page.waitForTimeout(900);
const search = async (ctx, origin, query) => JSON.stringify(await ctx.json(origin, `search?q=${encodeURIComponent(query)}`));

export const steps = [
  { id: id("01"), title: "定義外のステータス", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    await ctx.check("一覧に「定義外」として現れ、行が消えない", async () => {
      const { text } = await listText(ctx, page, server.origin, "dev-tracker");
      assert(/定義外の状態[\s\S]*定義外/.test(text), text);
    });
    await ctx.check("チケットを開いて編集できる", async () => {
      await page.goto(`${server.origin}/ja/pages/ticket-01accc000000000000000dev2/`, { waitUntil: "networkidle" });
      await button(page, "編集").click();
      await ctx.expect(page.locator("#plugin-field-status")).toBeEditable();
      await button(page, "キャンセル").first().click();
    });
    await ctx.check("errorではなくwarningで、validateが終了コード0", async () => {
      const result = validate(ctx, root);
      assert.equal(result.status, 0);
      const mine = JSON.parse(result.stdout).diagnostics.filter((item) => item.file?.includes("dev2"));
      assert(mine.length && mine.every((item) => item.severity === "warning"), JSON.stringify(mine));
    });
  } },

  { id: id("02"), title: "定義外の項目と必須項目の欠落", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    const file = ctx.path.join(root, "content/dev/+tickets/ticket-01accc000000000000000dev3.yaml");
    await page.goto(`${server.origin}/ja/pages/ticket-01accc000000000000000dev3/`, { waitUntil: "networkidle" });
    await ctx.check("定義に無い項目の値が保持され、読み取り専用で見える", async () => {
      await ctx.expect(page.locator("main")).toContainText("残す値");
    });
    await ctx.check("必須項目が欠けたチケットも開けて編集できる", async () => {
      await button(page, "編集").click();
      await ctx.expect(page.locator("#plugin-field-priority")).toBeEditable();
    });
    await ctx.check("保存しても定義外の値が消えない", async () => {
      await page.locator("#plugin-field-priority").selectOption("low");
      const editor = page.locator('[contenteditable="true"]').first();
      await editor.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" C02");
      await page.waitForTimeout(400);
      await button(page, "保存").first().click();
      await button(page, "編集").waitFor();
      const saved = await ctx.fs.readFile(file, "utf8");
      assert.match(saved, /unknownField: 残す値/);
      assert.match(saved, /priority: low/);
    });
  } },

  { id: id("03"), title: "定義を変えても既存チケットが書き換わらない", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    ctx.git(root, "add", "."); ctx.git(root, "commit", "-qm", "before C03");
    await page.goto(`${server.origin}/ja/pages/dev-tracker/`, { waitUntil: "networkidle" });
    await button(page, "このチケット管理の設定").click();
    const openRow = page.locator('main [data-row="status"]').filter({ has: page.locator('input[value="open"]') });
    await ctx.check("使用中のステータスを消すと、影響を受ける件数が画面に示される", async () => {
      await openRow.getByRole("button", { name: "削除" }).click();
      await ctx.expect(page.locator("main")).toContainText(/[0-9]+件/);
      const text = await page.locator("main").innerText();
      assert(/(使って|使用|影響)[^\n]*[0-9]+件|[0-9]+件[^\n]*(使って|使用|影響)/.test(text), text.slice(0, 500));
    });
    await ctx.check("保存しても既存チケットのファイルが自動で書き換わらない", async () => {
      await button(page, "保存").last().click();
      await settle(page);
      const changed = ctx.git(root, "status", "--short").split("\n").filter(Boolean).map((line) => line.trim().split(/\s+/).pop());
      assert.deepEqual(changed, ["content/dev/tracker.yaml"]);
      ctx.git(root, "checkout", "--", "content/dev/tracker.yaml");
      await settle(page);
    });
  } },

  { id: id("04"), title: "定義リソースが無い／複数ある", async run(ctx) {
    const root = await ctx.temporary("ticket-c04");
    await ctx.fs.mkdir(ctx.path.join(root, "node_modules"), { recursive: true });
    await ctx.fs.symlink(ctx.path.join(ctx.repository, "node_modules/@vellym"), ctx.path.join(root, "node_modules/@vellym"), "dir");
    await ctx.write(root, "vellym.config.yaml", 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist/site\nui:\n  language: ja\nplugins:\n  - "@vellym/tickets"\n');
    await ctx.write(root, "content/guide.yaml", "apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata: { name: guide, title: 案内 }\nspec:\n  locale: ja\n  blocks:\n    - { id: body, type: rich-text, content: 本文 }\n");
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    ctx.state.page = page;
    await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
    await ctx.check("TicketTrackerが1つも無くてもエラー画面にならず、チケットの画面が無く、追加メニューから作れる", async () => {
      await ctx.expect(page.getByRole("heading", { level: 1, name: "案内" })).toBeVisible();
      await ctx.expect(page.getByRole("alert")).toHaveCount(0);
      await button(page, "新規作成").click();
      await ctx.expect(page.getByRole("menuitem", { name: "チケット管理" })).toBeVisible();
      await page.keyboard.press("Escape");
    });
    const before = diagnostics(ctx, root).length;
    await ctx.write(root, "content/work/b-tracker.yaml", tracker("b-tracker", "後のTracker", [["open", "未着手", "open"]]));
    await ctx.write(root, "content/work/a-tracker.yaml", tracker("a-tracker", "先のTracker", [["open", "未着手", "open"]]));
    await ctx.write(root, "content/work/+tickets/ticket-01accc0000000000000000two.yaml", ticket("ticket-01accc0000000000000000two", "二重の定義", "open", "{}"));
    await settle(page);
    await ctx.check("同じフォルダに2つあると、metadata.name昇順の先頭が使われ、警告は増えない", async () => {
      assert.equal(diagnostics(ctx, root).length, before, JSON.stringify(diagnostics(ctx, root)));
      await page.goto(`${server.origin}/ja/pages/ticket-01accc0000000000000000two/`, { waitUntil: "networkidle" });
      await ctx.expect(page.locator("main")).toContainText("先のTracker");
    });
    await server.stop();
  } },

  { id: id("05"), title: "工程ごとに独立して置ける", async run(ctx) {
    const { server, page } = await workspace(ctx);
    const dev = await listText(ctx, page, server.origin, "dev-tracker");
    const qa = await listText(ctx, page, server.origin, "qa-tracker");
    await ctx.check("文書ツリーの両方の位置にTicketTrackerが現れる", async () => {
      const tree = page.getByRole("treegrid").first();
      await ctx.expect(tree.getByText("開発の作業", { exact: true })).toBeVisible();
      await ctx.expect(tree.getByText("品質の作業", { exact: true })).toBeVisible();
    });
    await ctx.check("それぞれの一覧に自分の配下のチケットだけが出る", async () => {
      assert(dev.text.includes("開発の作業1") && !dev.text.includes("品質の作業1"), dev.text);
      assert(qa.text.includes("品質の作業1") && !qa.text.includes("開発の作業1"), qa.text);
    });
    await ctx.check("列と選択肢がそれぞれの定義どおりに異なる", async () => {
      assert(dev.headers.includes("優先度") && !dev.headers.includes("重大度"), dev.headers.join(","));
      assert(qa.headers.includes("重大度") && !qa.headers.includes("優先度"), qa.headers.join(","));
    });
    await ctx.check("詳細画面の入力欄も、属するチケット管理の定義に従う", async () => {
      await page.goto(`${server.origin}/ja/pages/ticket-01accc0000000000000000qa1/`, { waitUntil: "networkidle" });
      await button(page, "編集").click();
      await ctx.expect(page.locator("#plugin-field-severity")).toBeVisible();
      await ctx.expect(page.locator("#plugin-field-priority")).toHaveCount(0);
      const options = await page.locator("#plugin-field-status option").allInnerTexts();
      assert(options.some((option) => /調査中/.test(option)), options.join(","));
      await button(page, "キャンセル").first().click();
    });
  } },

  { id: id("06"), title: "入れ子と最も近い祖先", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    await ctx.check("子フォルダ配下のチケットの定義は子側になり、子側にしか無いステータスが定義外にならない", async () => {
      await page.goto(`${server.origin}/ja/pages/ticket-01accc0000000000000000ui1/`, { waitUntil: "networkidle" });
      await ctx.expect(page.locator("main")).toContainText("確認中");
      assert(!diagnostics(ctx, root).some((item) => item.file?.includes("ui1")));
    });
    await ctx.check("そのチケットが親側の一覧にも出る", async () => {
      assert((await listText(ctx, page, server.origin, "dev-tracker")).text.includes("画面の作業1"));
    });
    await ctx.check("親側の一覧で、子側にしか無いステータス値を理由に警告が出ない", async () => {
      const { text } = await listText(ctx, page, server.origin, "dev-tracker");
      const row = text.split("\n").find((line) => line.includes("画面の作業1")) ?? "";
      assert(!/定義外|注意/.test(row), row);
    });
  } },

  { id: id("06b"), title: "属性ごとのフォルダ分け", async run(ctx) {
    const { server, page } = await workspace(ctx);
    await ctx.check("TicketTrackerの無い子フォルダのチケットがすべて上位の一覧に出て、上位の定義が適用される", async () => {
      const { text } = await listText(ctx, page, server.origin, "dev-tracker");
      assert(text.includes("分類したAPIの作業") && text.includes("分類した画面の作業"), text);
      await page.goto(`${server.origin}/ja/pages/ticket-01accc000000000000000api1/`, { waitUntil: "networkidle" });
      await ctx.expect(page.locator("main")).toContainText("開発の作業");
    });
  } },

  { id: id("07"), title: "移動しても所属が壊れない", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    const before = (await listText(ctx, page, server.origin, "qa-tracker")).text;
    await ctx.check("TicketTrackerをチケットごとフォルダ移動しても、一覧の内容が変わらない", async () => {
      await ctx.fs.mkdir(ctx.path.join(root, "content/moved"), { recursive: true });
      await ctx.fs.rename(ctx.path.join(root, "content/qa"), ctx.path.join(root, "content/moved/qa"));
      await settle(page);
      assert.equal((await listText(ctx, page, server.origin, "qa-tracker")).text, before);
    });
    await ctx.check("フォルダを改称しても同じ", async () => {
      await ctx.fs.rename(ctx.path.join(root, "content/moved/qa"), ctx.path.join(root, "content/moved/quality"));
      await settle(page);
      assert.equal((await listText(ctx, page, server.origin, "qa-tracker")).text, before);
    });
    await ctx.check("チケット1件だけを別のTicketTrackerの配下へ移すと移動先の一覧に移り、定義外のステータスは警告になる", async () => {
      await ctx.fs.rename(ctx.path.join(root, "content/dev/+tickets/ticket-01accc000000000000000dev1.yaml"), ctx.path.join(root, "content/moved/quality/+tickets/ticket-01accc000000000000000dev1.yaml"));
      await settle(page);
      assert((await listText(ctx, page, server.origin, "qa-tracker")).text.includes("開発の作業1"));
      assert(!(await listText(ctx, page, server.origin, "dev-tracker")).text.includes("開発の作業1"));
      const result = validate(ctx, root);
      assert.equal(result.status, 0);
      assert(JSON.parse(result.stdout).diagnostics.filter((item) => item.file?.includes("dev1")).every((item) => item.severity === "warning"));
    });
    await ctx.check("画面から移す場合、移動先のチケット管理が変わることが操作前に示される", async () => {
      ctx.blocked("チケットは文書ツリーに出ず、詳細画面にも移動の操作が無いため、画面から移す経路が無い（ファイルの移動で上の確認を行った）。");
    });
  } },

  { id: id("08"), title: "どこにも属さないチケット", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    const name = "ticket-01accc00000000000000orph1";
    const result = validate(ctx, root);
    await ctx.check("validateが終了コード0", async () => assert.equal(result.status, 0));
    await ctx.check("どの一覧にも出ない", async () => {
      for (const trackerName of ["dev-tracker", "qa-tracker", "ui-tracker"]) assert(!(await listText(ctx, page, server.origin, trackerName)).text.includes("どこにも属さない"));
    });
    await ctx.check("未解釈リソースの集約表示（設定・読み込みの問題）から所在が分かる", async () => {
      await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^設定/ }).first().click();
      await ctx.expect(page.locator("main")).toContainText("notes/ticket-01accc00000000000000orph1.yaml");
    });
    await ctx.check("全文検索と内部リンクから到達できる", async () => {
      assert((await search(ctx, server.origin, "どこにも属さないの本文")).includes(name));
      await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
      await page.getByRole("link", { name: /どこにも属さない/ }).first().click();
      await ctx.expect(page.getByRole("heading", { level: 1, name: "どこにも属さない" })).toBeVisible();
    });
    await ctx.check("ファイルが移動も削除もされていない", async () => {
      await ctx.fs.access(ctx.path.join(root, `content/notes/${name}.yaml`));
    });
  } },

  { id: id("08b"), title: "一覧にも警告にも出さずに残す", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    const before = diagnostics(ctx, root).length;
    const name = "ticket-01accc00000000000000hid1";
    await ctx.write(root, `content/_hidden/${name}.yaml`, ticket(name, "隠したチケット", "open"));
    await ctx.write(root, "content/dev/_drafts/ticket-01accc00000000000000hid2.yaml", ticket("ticket-01accc00000000000000hid2", "Tracker配下の隠したチケット", "open"));
    await settle(page);
    await ctx.check("どの一覧にも出ない（Tracker配下の_フォルダでも）", async () => {
      const { text } = await listText(ctx, page, server.origin, "dev-tracker");
      assert(!text.includes("隠したチケット"), text);
    });
    await ctx.check("文書ツリーにも出ず、フォルダ自体が現れない", async () => {
      const tree = page.getByRole("treegrid").first();
      await ctx.expect(tree.getByText("_hidden")).toHaveCount(0);
      await ctx.expect(tree.getByText("_drafts")).toHaveCount(0);
    });
    await ctx.check("警告が出ず、validateの診断件数が増えない", async () => assert.equal(diagnostics(ctx, root).length, before));
    await ctx.check("全文検索と内部リンクから到達でき、本文が読める", async () => {
      assert((await search(ctx, server.origin, "隠したチケットの本文")).includes(name));
      await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
      await page.getByRole("link", { name: /隠したチケット|ticket-01accc00000000000000hid1/ }).first().click();
      await ctx.expect(page.getByText("隠したチケットの本文")).toBeVisible();
    });
    await ctx.check("ファイルが移動も削除もされていない", async () => {
      await ctx.fs.access(ctx.path.join(root, `content/_hidden/${name}.yaml`));
      await ctx.fs.access(ctx.path.join(root, "content/dev/_drafts/ticket-01accc00000000000000hid2.yaml"));
    });
  } },

  { id: id("09"), title: "アーカイブは判定に乗らない", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    const name = "ticket-01accc000000000000000arc1";
    await ctx.write(root, `content/dev/+tickets/${name}.yaml`, ticket(name, "アーカイブする作業", "mystery"));
    await settle(page);
    const warnedBefore = diagnostics(ctx, root).filter((item) => item.file?.includes("arc1")).length;
    await listText(ctx, page, server.origin, "dev-tracker");
    await page.getByRole("checkbox", { name: "アーカイブする作業" }).check();
    await button(page, "アーカイブへ移動").click();
    await settle(page);
    await ctx.check("_archive/配下へ移り、どの一覧からも消える", async () => {
      const files = await ctx.fs.readdir(ctx.path.join(root, "content"), { recursive: true });
      assert(files.some((file) => file.includes("_archive") && file.endsWith(`${name}.yaml`)), files.filter((file) => file.includes("_archive")).join(","));
      assert(!(await listText(ctx, page, server.origin, "dev-tracker")).text.includes("アーカイブする作業"));
    });
    await ctx.check("アーカイブ済みのチケットについて警告が出ず、件数にも数えられない", async () => {
      assert(warnedBefore > 0, "前提: アーカイブ前は定義外の警告がある");
      assert.equal(diagnostics(ctx, root).filter((item) => item.file?.includes("arc1")).length, 0);
    });
    await ctx.check("復元すると元の位置へ戻り、同じ一覧に現れる", async () => {
      await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^設定/ }).first().click();
      const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "アーカイブ済み" }) });
      await section.getByRole("button", { name: /復元|元に戻す/ }).first().click();
      const confirm = page.getByRole("dialog");
      if (await confirm.count()) await confirm.getByRole("button", { name: /復元|適用|実行|戻す/ }).last().click();
      await settle(page);
      await ctx.fs.access(ctx.path.join(root, `content/dev/+tickets/${name}.yaml`));
      assert((await listText(ctx, page, server.origin, "dev-tracker")).text.includes("アーカイブする作業"));
    });
    await ctx.state.ticketC.server.stop();
  } }
];
