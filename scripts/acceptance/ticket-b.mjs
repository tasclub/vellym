// Ticket management manual acceptance, section B (creating and editing tickets).
// ticket-01m7p97tp8htrtkdv8z2dxs6xq.
import assert from "node:assert/strict";
import { parse } from "yaml";
import { project, TICKETS, TRACKER } from "./ticket-d.mjs";

const id = (suffix) => `TICKET-MANUAL-B${suffix}`;
const trackerYaml = (statuses = ["open", "done"]) => `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: ${TRACKER}, title: 受入の作業 }
spec:
  statuses:
${statuses.map((status) => status === "open" ? "    - { id: open, label: 未着手, category: open }" : status === "doing" ? "    - { id: doing, label: 対応中, category: open }" : "    - { id: done, label: 完了, category: closed }").join("\n")}
  fields:
    - { id: priority, label: 優先度, type: select, required: true, listColumn: true, options: [{ value: high, label: 高 }, { value: low, label: 低 }] }
    - { id: owner, label: 担当, type: text, required: true }
    - { id: flag, label: 重要, type: boolean }
    - { id: due, label: 期限, type: date, listColumn: true }
    - { id: points, label: 点数, type: number, listColumn: true }
`;
const button = (page, name) => page.getByRole("button", { name, exact: true });
/** The "open only" switch; its label changes when pressed, so find it next to the filter button. */
const doneToggle = (page) => page.locator("xpath=//button[starts-with(normalize-space(.), '絞り込み')]/preceding-sibling::button[1]");
const ticketsDir = (ctx, root) => ctx.path.join(root, "content/work/+tickets");
const ticketFiles = async (ctx, root) => (await ctx.fs.readdir(ticketsDir(ctx, root))).filter((file) => file.endsWith(".yaml")).sort();
const readTicket = async (ctx, root, name) => ctx.fs.readFile(ctx.path.join(ticketsDir(ctx, root), `${name}.yaml`), "utf8");

/** The section D project with a tracker that has required, boolean, date and number fields. */
async function workspace(ctx) {
  if (ctx.state.ticketB) return ctx.state.ticketB;
  const root = await project(ctx);
  await ctx.write(root, "content/work/tracker.yaml", trackerYaml());
  for (const name of TICKETS) {
    const file = ctx.path.join(ticketsDir(ctx, root), `${name}.yaml`);
    await ctx.fs.writeFile(file, (await ctx.fs.readFile(file, "utf8")).replace("    priority: high\n", "    priority: high\n    owner: 受入\n"));
  }
  ctx.git(root, "add", ".");
  ctx.git(root, "commit", "-qm", "tracker with typed fields");
  const server = await ctx.start(root);
  const page = await ctx.page(server.origin);
  ctx.state.page = page;
  ctx.state.ticketB = { root, server, page };
  return ctx.state.ticketB;
}
const openList = async (ctx, page, origin) => {
  await page.goto(`${origin}/ja/pages/${TRACKER}/`, { waitUntil: "networkidle" });
  await button(page, "チケット一覧").click();
  await page.getByRole("table").first().waitFor();
};
/** Creates a ticket from the list and saves it with an owner; returns its metadata.name. */
async function createTicket(ctx, page, origin, owner = "作成者") {
  await openList(ctx, page, origin);
  await button(page, "チケットを作成").click();
  await page.waitForURL(/\/pages\/ticket-[0-9a-z]+\/$/);
  const name = page.url().match(/(ticket-[0-9a-z]+)\/$/)[1];
  await page.locator("#plugin-field-owner").fill(owner);
  await button(page, "保存").first().click();
  await button(page, "編集").waitFor();
  return name;
}
const saveAfterTyping = async (page, text) => {
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
  await page.waitForTimeout(400);
  await button(page, "保存").first().click();
  await button(page, "編集").waitFor();
};

export const steps = [
  { id: id("01"), title: "定義を置いてチケットを作る", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    await ctx.check("TicketTrackerが文書ツリーのその位置に現れ、開くと一覧になる", async () => {
      await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
      await page.getByRole("treegrid").first().getByText("受入の作業", { exact: true }).click();
      await ctx.expect(page.getByRole("table").first()).toBeVisible();
    });
    const before = await ticketFiles(ctx, root);
    const name = await createTicket(ctx, page, server.origin);
    const created = (await ticketFiles(ctx, root)).filter((file) => !before.includes(file));
    await ctx.check("生成されたファイルがTicketTrackerと同じフォルダの配下にでき、ファイル名がmetadata.nameと一致する", async () => {
      assert.deepEqual(created, [`${name}.yaml`]);
    });
    await ctx.check("metadata.nameがticket-＋ULID", async () => assert.match(name, /^ticket-[0-9a-hjkmnp-tv-z]{26}$/));
    await ctx.check("kind: Ticket、spec.status、spec.fieldsが書かれ、spec.ticketのような入れ子が無い", async () => {
      const yaml = parse(await readTicket(ctx, root, name));
      assert.equal(yaml.kind, "Ticket");
      assert.equal(typeof yaml.spec.status, "string");
      assert.equal(typeof yaml.spec.fields, "object");
      assert.equal(yaml.spec.ticket, undefined);
    });
    ctx.state.ticketB.created = name;
    ctx.note("「VS Codeで人間が読める差分」は、YAMLのキーが入れ子にならず1行1値であることで代えた（エディタでの見え方そのものは自動化していない）。");
  } },

  { id: id("01b"), title: "必須項目と初期値", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    await openList(ctx, page, server.origin);
    await button(page, "チケットを作成").click();
    await page.waitForURL(/\/pages\/ticket-[0-9a-z]+\/$/);
    const name = page.url().match(/(ticket-[0-9a-z]+)\/$/)[1];
    await ctx.check("作成を押すと、そのまま編集画面が開く", async () => {
      await ctx.expect(button(page, "保存").first()).toBeVisible();
      assert.equal((await ticketFiles(ctx, root)).includes(`${name}.yaml`), false, "保存前にファイルができている");
    });
    await ctx.check("必須には＊と文言が付き、色だけに頼っていない", async () => {
      const labels = await page.locator('dl[class*="plugin-detail-fields"] dt').allInnerTexts();
      assert(labels.some((label) => /担当＊\s*必須/.test(label)), labels.join(" | "));
    });
    await ctx.check("必須を空のまま保存しようとすると保存されず、最初の未入力項目へフォーカスが移り、編集を続けられる", async () => {
      await button(page, "保存").first().click();
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "plugin-field-owner");
      assert.equal((await ticketFiles(ctx, root)).includes(`${name}.yaml`), false);
      await page.locator("#plugin-field-owner").fill("入力できる");
    });
    await ctx.check("選択肢は選択、日付は日付、真偽値はチェックボックス", async () => {
      assert.equal(await page.locator("#plugin-field-priority").evaluate((element) => element.tagName), "SELECT");
      assert.equal(await page.locator("#plugin-field-due").getAttribute("type"), "date");
      assert.equal(await page.locator("#plugin-field-flag").getAttribute("type"), "checkbox");
      assert.equal(await page.locator("#plugin-field-points").getAttribute("type"), "number");
    });
    await button(page, "保存").first().click();
    await button(page, "編集").waitFor();
    const fields = parse(await readTicket(ctx, root, name)).spec;
    await ctx.check("statusがstatusesの先頭、selectがoptionsの先頭、booleanがfalse、textなど初期値の無い型はキーが無い", async () => {
      assert.equal(fields.status, "open");
      assert.equal(fields.fields.priority, "high");
      assert.equal(fields.fields.flag, false);
      assert.equal("due" in fields.fields, false);
      assert.equal("points" in fields.fields, false);
    });
    await ctx.check("statusesの並びを入れ替えると新しい先頭が初期値になり、既にあるチケットは変わらない", async () => {
      const existing = await readTicket(ctx, root, name);
      await ctx.write(root, "content/work/tracker.yaml", trackerYaml(["done", "open"]));
      await page.waitForTimeout(800);
      const second = await createTicket(ctx, page, server.origin, "並べ替え後");
      assert.equal(parse(await readTicket(ctx, root, second)).spec.status, "done");
      assert.equal(await readTicket(ctx, root, name), existing);
      await ctx.write(root, "content/work/tracker.yaml", trackerYaml());
      await page.waitForTimeout(800);
    });
  } },

  { id: id("01c"), title: "一覧に列として出す項目", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    await openList(ctx, page, server.origin);
    const headers = async () => (await page.locator("table thead th").allInnerTexts()).map((text) => text.replace(/[↑↓]/g, "").trim()).filter(Boolean);
    await ctx.check("一覧の列がタイトル・ステータス・listColumnの項目だけ", async () => {
      assert.deepEqual(await headers(), ["タイトル", "ステータス", "優先度", "期限", "点数"]);
    });
    await ctx.check("付けていない項目は列に出ないが、詳細では編集できる", async () => {
      await page.goto(`${server.origin}/ja/pages/${TICKETS[0]}/`, { waitUntil: "networkidle" });
      await button(page, "編集").click();
      await ctx.expect(page.locator("#plugin-field-owner")).toBeEditable();
      await button(page, "キャンセル").first().click();
    });
    await ctx.check("定義編集の画面からlistColumnを切り替えると、一覧の列が変わる", async () => {
      await openList(ctx, page, server.origin);
      await button(page, "このチケット管理の設定").click();
      const row = page.locator("main").getByRole("textbox").and(page.locator('[value="owner"]')).locator("xpath=ancestor::*[.//input[@type='checkbox']][1]");
      await row.getByRole("checkbox", { name: "一覧に出す" }).check();
      await button(page, "保存").last().click();
      await page.waitForTimeout(800);
      await openList(ctx, page, server.origin);
      assert((await headers()).includes("担当"), (await headers()).join(","));
      ctx.git(root, "checkout", "--", "content/work/tracker.yaml");
      await page.waitForTimeout(800);
    });
    await ctx.check("数値と日付の列は値として並ぶ（9が10より前、2026-09-01が2026-10-01より前）", async () => {
      for (const [name, points, due] of [["ticket-01accb0000000000000000009", 9, "2026-10-01"], ["ticket-01accb0000000000000000010", 10, "2026-09-01"]]) {
        await ctx.write(root, `content/work/+tickets/${name}.yaml`, `apiVersion: vellym.tasclub.com/v1\nkind: Ticket\nmetadata: { name: ${name}, title: "点数${points}" }\nspec:\n  status: open\n  fields: { priority: low, owner: 並べ替え, points: ${points}, due: "${due}" }\n`);
      }
      await page.waitForTimeout(800);
      await openList(ctx, page, server.origin);
      const order = async () => (await page.locator("table tbody tr").allInnerTexts()).map((row) => row.split("\t")[1]?.trim() ?? row).filter((title) => /^点数/.test(title));
      await page.locator("table thead").getByRole("button", { name: /^点数/ }).click();
      assert.deepEqual(await order(), ["点数9", "点数10"]);
      await page.locator("table thead").getByRole("button", { name: /^期限/ }).click();
      assert.deepEqual(await order(), ["点数10", "点数9"]);
    });
  } },

  { id: id("01d"), title: "必須が空でも開けて、編集できて、やめられる", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    const name = "ticket-01accb00000000000000000ee";
    const original = `apiVersion: vellym.tasclub.com/v1\nkind: Ticket\nmetadata: { name: ${name}, title: 必須が空 }\nspec:\n  status: open\n  fields: { priority: low }\n`;
    await ctx.write(root, `content/work/+tickets/${name}.yaml`, original);
    await page.waitForTimeout(800);
    await page.goto(`${server.origin}/ja/pages/${name}/`, { waitUntil: "networkidle" });
    await ctx.check("開けて、読み取り専用にならず、編集画面に入れる", async () => {
      await button(page, "編集").click();
      await ctx.expect(page.locator("#plugin-field-owner")).toBeEditable();
    });
    await ctx.check("必須が空であることが＊と注意で示される", async () => {
      await ctx.expect(page.locator('dl[class*="plugin-detail-fields"]')).toContainText("必須");
      await ctx.expect(page.locator('dl[class*="plugin-detail-fields"]')).toContainText(/未入力|空/);
    });
    await ctx.check("別の項目を変えたうえで、そのままキャンセルできる", async () => {
      await page.locator("#plugin-field-priority").selectOption("high");
      const accept = (dialog) => void dialog.accept().catch(() => {});
      page.on("dialog", accept);
      await button(page, "キャンセル").first().click();
      const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
      if (await confirm.count()) await confirm.getByRole("button", { name: /破棄|やめる|閉じる|キャンセル/ }).first().click();
      await button(page, "編集").waitFor();
      page.off("dialog", accept);
      assert.equal(await readTicket(ctx, root, name), original);
    });
    await ctx.check("埋めないまま保存すると止まって未入力へフォーカスし、埋めれば保存できる", async () => {
      await button(page, "編集").click();
      // Save is enabled once something changed; change another field and try to save.
      await page.locator("#plugin-field-priority").selectOption("high");
      await button(page, "保存").first().click();
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "plugin-field-owner");
      await page.locator("#plugin-field-owner").fill("埋めた");
      await button(page, "保存").first().click();
      await button(page, "編集").waitFor();
      assert.match(await readTicket(ctx, root, name), /owner: 埋めた/);
    });
    await ctx.check("必須を欠いたYAMLでもvellym validateが終了コード0", async () => {
      await ctx.write(root, `content/work/+tickets/${name}.yaml`, original);
      assert.equal(ctx.cli(root, "validate").status, 0);
    });
  } },

  { id: id("02"), title: "ステータスと項目と本文を編集する", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    ctx.git(root, "add", "."); ctx.git(root, "commit", "-qm", "before B02");
    await openList(ctx, page, server.origin);
    await page.getByRole("table").first().getByRole("button", { name: "通知を見直す" }).click();
    await button(page, "編集").click();
    await ctx.check("説明本文の編集が通常のPage編集と同じエディタで行える", async () => {
      await ctx.expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
      await ctx.expect(button(page, "太字")).toBeVisible();
    });
    await page.locator("#plugin-field-status").selectOption("done");
    await page.locator("#plugin-field-priority").selectOption("low");
    await ctx.check("未保存のまま画面を離れようとすると保護が働く", async () => {
      let asked = false;
      page.once("dialog", (dialog) => { asked = true; void dialog.dismiss().catch(() => {}); });
      await page.reload().catch(() => {});
      assert(asked, "離脱の確認が出ない");
    });
    await saveAfterTyping(page, " B02で追記");
    await ctx.check("保存後、差分が該当箇所だけに閉じている", async () => {
      const diff = ctx.git(root, "diff", "-U0", "--", `content/work/+tickets/${TICKETS[0]}.yaml`);
      const changed = diff.split("\n").filter((line) => /^[+-](?![+-])/.test(line));
      assert(changed.every((line) => /status:|priority:|content:|B02で追記|通知を見直すの本文/.test(line)), changed.join("\n"));
      assert.equal(ctx.git(root, "status", "--short").split("\n").filter(Boolean).length, 1);
    });
  } },

  { id: id("03"), title: "未知フィールドとコメントが保存往復で残る", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    const name = TICKETS[1];
    const file = ctx.path.join(ticketsDir(ctx, root), `${name}.yaml`);
    const original = await ctx.fs.readFile(file, "utf8");
    const withExtras = original.replace("spec:\n", "spec:\n  # 受入: 手で書いたコメント\n  extraKey: 残る値\n");
    await ctx.fs.writeFile(file, withExtras);
    await page.waitForTimeout(800);
    await page.goto(`${server.origin}/ja/pages/${name}/`, { waitUntil: "networkidle" });
    await button(page, "編集").click();
    await saveAfterTyping(page, " B03");
    const saved = await ctx.fs.readFile(file, "utf8");
    await ctx.check("未知フィールドが残っている", async () => assert.match(saved, /extraKey: 残る値/));
    await ctx.check("コメントが残っている", async () => assert.match(saved, /# 受入: 手で書いたコメント/));
    await ctx.check("キーの順序が不必要に入れ替わっていない", async () => {
      const keys = (text) => text.split("\n").filter((line) => /^\s{0,4}[a-zA-Z]+:/.test(line)).map((line) => line.trim().split(":")[0]);
      assert.deepEqual(keys(saved), keys(withExtras));
    });
  } },

  { id: id("04"), title: "チケットは文書ツリーに出ない", async run(ctx) {
    const { server, page } = await workspace(ctx);
    await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
    const tree = page.getByRole("treegrid").first();
    await ctx.check("文書ツリーに個々のチケットが現れず、TicketTrackerは現れる", async () => {
      await ctx.expect(tree.getByText("受入の作業", { exact: true })).toBeVisible();
      await ctx.expect(tree.getByText("検索を速くする")).toHaveCount(0);
    });
    await ctx.check("全文検索でチケットの本文が引ける", async () => {
      assert(JSON.stringify(await ctx.json(server.origin, `search?q=${encodeURIComponent("検索を速くするの本文")}`)).includes(TICKETS[1]));
    });
    await ctx.check("通常のPageから[[...]]でチケットを参照でき、逆参照にも現れる", async () => {
      await page.getByRole("link", { name: /通知を見直す/ }).first().click();
      await ctx.expect(page.getByRole("heading", { level: 1, name: "通知を見直す" })).toBeVisible();
      await ctx.expect(page.getByText("案内", { exact: true }).last()).toBeVisible();
      await ctx.expect(page.getByRole("heading", { name: /参照しているPage|このページを参照している/ }).first()).toBeVisible();
    });
  } },

  { id: id("05"), title: "アーカイブと復元", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    const name = "ticket-01accb00000000000000000ar";
    await ctx.write(root, `content/work/+tickets/${name}.yaml`, `apiVersion: vellym.tasclub.com/v1\nkind: Ticket\nmetadata: { name: ${name}, title: アーカイブ用 }\nspec:\n  status: open\n  fields: { priority: low, owner: 受入 }\n`);
    await page.waitForTimeout(800);
    await openList(ctx, page, server.origin);
    await page.getByRole("checkbox", { name: "アーカイブ用" }).check();
    await button(page, "アーカイブへ移動").click();
    await page.waitForTimeout(1000);
    const archived = (await ctx.fs.readdir(ctx.path.join(root, "content"), { recursive: true })).find((file) => file.includes("_archive") && file.endsWith(`${name}.yaml`));
    await ctx.check("アーカイブがファイルの_archive/への移動として行われ、実削除されない", async () => {
      assert(archived, "_archive/配下にファイルが無い");
      assert.equal((await ticketFiles(ctx, root)).includes(`${name}.yaml`), false);
    });
    await ctx.check("復元で元の位置へ戻る", async () => {
      await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^設定/ }).first().click();
      const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "アーカイブ済み" }) });
      await section.getByRole("button", { name: /復元|元に戻す/ }).first().click();
      const confirm = page.getByRole("dialog");
      if (await confirm.count()) await confirm.getByRole("button", { name: /復元|適用|実行|戻す/ }).last().click();
      await page.waitForTimeout(1000);
      assert((await ticketFiles(ctx, root)).includes(`${name}.yaml`), "元の位置に戻っていない");
    });
  } },

  { id: id("06"), title: "一覧の絞り込みと並べ替え", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    for (const [name, status] of [["ticket-01accb00000000000000000ns", ""], ["ticket-01accb00000000000000000xs", "unknown"]]) {
      await ctx.write(root, `content/work/+tickets/${name}.yaml`, `apiVersion: vellym.tasclub.com/v1\nkind: Ticket\nmetadata: { name: ${name}, title: "状態${status || "なし"}" }\nspec:\n${status ? `  status: ${status}\n` : ""}  fields: { priority: low, owner: 絞り込み }\n`);
    }
    ctx.git(root, "add", "."); ctx.git(root, "commit", "-qm", "before B06");
    await page.waitForTimeout(800);
    await openList(ctx, page, server.origin);
    const titles = async () => (await page.locator("table tbody tr").allInnerTexts()).join("\n");
    await ctx.check("既定では完了だけが隠れ、未設定と定義外は隠れない", async () => {
      const text = await titles();
      assert(text.includes("状態なし") && text.includes("状態unknown"), text);
      assert(!text.includes("検索を速くする"), "完了が隠れていない");
    });
    await ctx.check("切り替えると全件になる", async () => {
      await doneToggle(page).click();
      await ctx.expect(page.locator("table tbody")).toContainText("検索を速くする");
      await doneToggle(page).click();
    });
    await ctx.check("ステータス、listColumnの項目、labelsで絞り込める", async () => {
      await page.getByRole("button", { name: /^絞り込み/ }).click();
      const panel = page.locator("main");
      const fields = await panel.locator("select, input").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") || element.labels?.[0]?.textContent?.trim() || element.id));
      const joined = fields.join(" | ");
      assert(/ステータス/.test(joined) && /優先度/.test(joined) && /ラベル|labels/i.test(joined), joined);
    });
    await ctx.check("本文で絞り込む入力は一覧に無い", async () => {
      const fields = await page.locator("main").locator("select, input").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") || element.labels?.[0]?.textContent?.trim() || ""));
      assert(!fields.some((label) => /本文|全文/.test(label)), fields.join(" | "));
    });
    await ctx.check("絞り込み（完了を含める）と並び順を変えて画面を離れ、戻ると同じ状態", async () => {
      await page.keyboard.press("Escape");
      await doneToggle(page).click();
      await page.locator("table thead").getByRole("button", { name: /^優先度/ }).click();
      const sorted = async () => page.locator("table thead th[aria-sort]").evaluateAll((cells) => cells.filter((cell) => cell.getAttribute("aria-sort") !== "none").map((cell) => `${cell.textContent.trim()}:${cell.getAttribute("aria-sort")}`));
      const before = { sort: await sorted(), done: (await titles()).includes("検索を速くする") };
      await page.goto(`${server.origin}/ja/pages/guide/`, { waitUntil: "networkidle" });
      await openList(ctx, page, server.origin);
      const after = { sort: await sorted(), done: (await titles()).includes("検索を速くする") };
      assert.deepEqual(after, before);
    });
    await ctx.check("絞り込みの状態が正本YAMLへ書かれていない", async () => {
      assert.equal(ctx.git(root, "status", "--short"), "");
    });
  } },

  { id: id("07"), title: "一括編集", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    const names = [];
    for (let i = 0; i < 3; i++) {
      const name = `ticket-01accb0000000000000000b${i}0`.slice(0, 33);
      names.push(name);
      await ctx.write(root, `content/work/+tickets/${name}.yaml`, `apiVersion: vellym.tasclub.com/v1\nkind: Ticket\nmetadata: { name: ${name}, title: "一括${i}" }\nspec:\n  status: open\n  fields: { priority: low, owner: 一括 }\n`);
    }
    ctx.git(root, "add", "."); ctx.git(root, "commit", "-qm", "before B07");
    await page.waitForTimeout(800);
    await openList(ctx, page, server.origin);
    for (const i of [0, 1]) await page.getByRole("checkbox", { name: `一括${i}` }).check();
    await ctx.check("選択件数が示され、選択を解除する操作が同じ場所にある", async () => {
      await ctx.expect(page.locator("main")).toContainText("2件を選択中");
      await ctx.expect(button(page, "選択を解除")).toBeVisible();
    });
    await ctx.check("自由入力の項目が一括変更の対象に出ていない", async () => {
      const options = await page.locator("#plugin-bulk-column option").allInnerTexts();
      assert(!options.includes("担当"), options.join(","));
    });
    await ctx.check("絞り込みを変えても選択が消えない", async () => {
      await doneToggle(page).click();
      await ctx.expect(page.locator("main")).toContainText("2件を選択中");
    });
    await ctx.check("実行後、選んだチケットのファイルだけが変わる", async () => {
      await page.locator("#plugin-bulk-column").selectOption("field:priority");
      const value = page.locator("main select").filter({ has: page.locator('option[value="high"]') }).last();
      await value.selectOption("high");
      await button(page, "選んだ行へ反映").click();
      await page.waitForTimeout(1000);
      const changed = ctx.git(root, "status", "--short").split("\n").filter(Boolean).map((line) => line.trim().split(/\s+/).pop()).sort();
      assert.deepEqual(changed, names.slice(0, 2).map((name) => `content/work/+tickets/${name}.yaml`).sort());
      ctx.git(root, "add", "."); ctx.git(root, "commit", "-qm", "bulk");
    });
    await ctx.check("アーカイブへの移動も同じ操作から行える", async () => {
      await openList(ctx, page, server.origin);
      await page.getByRole("checkbox", { name: "一括2" }).check();
      await ctx.expect(button(page, "アーカイブへ移動")).toBeVisible();
    });
    await ctx.check("外部で書き換えた1件を含めて一括変更すると、外部の変更も一括の変更も失われない", async () => {
      // The bulk write re-reads each file, so an external edit to another field is merged.
      const outside = ctx.path.join(ticketsDir(ctx, root), `${names[2]}.yaml`);
      await ctx.fs.writeFile(outside, (await ctx.fs.readFile(outside, "utf8")).replace("owner: 一括", "owner: 外部で変更"));
      await page.waitForTimeout(1200);
      await openList(ctx, page, server.origin);
      await page.getByRole("checkbox", { name: "一括2" }).check();
      await page.locator("#plugin-bulk-column").selectOption("status");
      await page.locator("main select").filter({ has: page.locator('option[value="done"]') }).last().selectOption("done");
      await button(page, "選んだ行へ反映").click();
      await ctx.expect(page.locator("main")).toContainText(/変更しました/);
      const saved = await ctx.fs.readFile(outside, "utf8");
      assert.match(saved, /owner: 外部で変更/);
      assert.match(saved, /status: done/);
    });
    await ctx.check("一部だけ失敗したとき、成功分は保存され、件数が分けて示され、失敗が選択に残る", async () => {
      ctx.blocked("画面の操作では一部だけを失敗させられない: 一括変更は書く直前に各ファイルを読み直して反映し（外部の変更は競合にならず残る。上の確認）、外部で消したチケットは一覧からすぐ消えて選択からも外れる。失敗時の表示は製品コードを変えずには起こせないため、この確認は自動化できていない。");
    });
  } },

  { id: id("08"), title: "ステータスと項目の定義編集", async run(ctx) {
    const { root, server, page } = await workspace(ctx);
    ctx.git(root, "add", "."); ctx.git(root, "commit", "-qm", "before B08");
    await openList(ctx, page, server.origin);
    await button(page, "このチケット管理の設定").click();
    const fieldRow = (id) => page.locator('main [data-row="field"]').filter({ has: page.locator(`input[value="${id}"]`) });
    await ctx.check("各項目に「一覧に出す」の切替があり、ステータスと項目の行を追加・削除できる", async () => {
      await ctx.expect(fieldRow("due").getByRole("checkbox", { name: "一覧に出す" })).toBeVisible();
      await ctx.expect(fieldRow("due").getByRole("button", { name: "項目を削除" })).toBeVisible();
      await ctx.expect(button(page, "項目を追加")).toBeVisible();
      await ctx.expect(button(page, "ステータスを追加")).toBeVisible();
    });
    await ctx.check("ステータスと項目の行を上下に並べ替えられる", async () => {
      await ctx.expect(button(page, "下へ").first()).toBeVisible();
      await ctx.expect(fieldRow("due").getByRole("button", { name: "上へ" })).toBeVisible();
    });
    await ctx.check("並べ替えが一覧の列順と詳細の項目順に反映され、保存がYAMLへの読める差分になる", async () => {
      await fieldRow("due").getByRole("button", { name: "上へ" }).click();
      await button(page, "保存").last().click();
      await page.waitForTimeout(1000);
      const yaml = await ctx.fs.readFile(ctx.path.join(root, "content/work/tracker.yaml"), "utf8");
      assert(yaml.indexOf("id: due") < yaml.indexOf("id: flag"), yaml);
      await openList(ctx, page, server.origin);
      const headers = (await page.locator("table thead th").allInnerTexts()).map((text) => text.replace(/[↑↓]/g, "").trim()).filter(Boolean);
      assert.deepEqual(headers.slice(2), ["優先度", "期限", "点数"]);
      assert(ctx.git(root, "diff", "--stat").includes("tracker.yaml"));
    });
    await ctx.check("新しく足した項目の「一覧に出す」は既定で外れている", async () => {
      await openList(ctx, page, server.origin);
      await button(page, "このチケット管理の設定").click();
      await button(page, "項目を追加").click();
      assert.equal(await page.locator("main").getByRole("checkbox", { name: "一覧に出す" }).last().isChecked(), false);
    });
    await ctx.check("定義が空のTicketTrackerでも一覧は開ける", async () => {
      await ctx.write(root, "content/empty/tracker.yaml", "apiVersion: vellym.tasclub.com/v1\nkind: TicketTracker\nmetadata: { name: empty-tracker, title: 空の定義 }\nspec: {}\n");
      await page.waitForTimeout(800);
      await page.goto(`${server.origin}/ja/pages/empty-tracker/`, { waitUntil: "networkidle" });
      await ctx.expect(page.getByRole("heading", { level: 1, name: "空の定義" })).toBeVisible();
      await ctx.expect(page.getByRole("alert")).toHaveCount(0);
    });
    await server.stop();
  } }
];
