import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const LIMITS = {
  repositoryMs: 2_000,
  searchApiMs: 1_000,
  searchUiMs: 1_500
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object", "空きportを取得できませんでした");
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

function pageYaml(index) {
  const padded = String(index).padStart(3, "0");
  const marker = index === 99 ? "検証目印-099" : `検証本文-${padded}`;
  return `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: page-${padded}
  title: 検証ページ ${padded}
spec:
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: |
        ## 概要

        ${marker}

        **太字**と*強調*、[リンク](https://example.com)、\`code\`。

        - 項目1
        - 項目2

        > 引用

        \`\`\`text
        code block
        \`\`\`

        編集位置:
`;
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-core-verify-"));
  const content = path.join(root, "docs/content");
  await Promise.all(
    Array.from({ length: 10 }, (_, folder) =>
      mkdir(path.join(content, `section-${folder}`), { recursive: true })
    )
  );
  await writeFile(
    path.join(content, "broken.yaml"),
    "apiVersion: vellym.tasclub.com/v1alpha1\nkind: Page\nmetadata: [\n",
    "utf8"
  );
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      writeFile(
        path.join(
          content,
          `section-${Math.floor(index / 10)}`,
          `page-${String(index).padStart(3, "0")}.yaml`
        ),
        pageYaml(index),
        "utf8"
      )
    )
  );
  const configPath = path.join(root, "vellym.config.yaml");
  await writeFile(
    configPath,
    "schemaVersion: \"1.0\"\ncontentRoot: docs/content\noutputDir: dist/vellym\nui:\n  language: ja\nplugins: []\n",
    "utf8"
  );
  return { root, configPath };
}

async function waitUntilReady(baseUrl, processOutput) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/bootstrap`);
      if (response.ok) return;
    } catch {
      // Server startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`dev serverが起動しませんでした\n${processOutput()}`);
}

async function timedJson(url) {
  const started = performance.now();
  const response = await fetch(url);
  const elapsed = performance.now() - started;
  assert(response.ok, `${url} が ${response.status} を返しました`);
  return { body: await response.json(), elapsed };
}

async function assertA11y(page, state) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  if (result.violations.length > 0) {
    const details = result.violations.map((violation) => {
      const targets = violation.nodes
        .flatMap((node) => node.target)
        .slice(0, 5)
        .join(", ");
      return `${violation.id}: ${violation.help} (${targets})`;
    });
    throw new Error(`${state}のaxe検査に失敗しました\n${details.join("\n")}`);
  }
}

async function verify() {
  const fixture = await createFixture();
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const cli = path.resolve("packages/vellym/dist/cli.mjs");
  const server = spawn(
    process.execPath,
    [cli, "dev", "--config", fixture.configPath, "--port", String(port)],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
  );
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  let browser;

  try {
    await waitUntilReady(baseUrl, () => output);

    const repository = await timedJson(`${baseUrl}/api/v1/repository`);
    assert(
      repository.body.data.pages.length === 100,
      `repository APIは${repository.body.data.pages.length}ページを返しました`
    );
    assert(
      repository.body.diagnostics.some((item) => item.file === "broken.yaml"),
      "壊れた単一YAMLが診断へ隔離されません"
    );
    assert(
      repository.elapsed <= LIMITS.repositoryMs,
      `repository APIが基準を超えました: ${Math.round(repository.elapsed)}ms`
    );

    const search = await timedJson(
      `${baseUrl}/api/v1/search?q=${encodeURIComponent("検証目印-099")}`
    );
    assert(search.body.data.total === 1, "100ページ検索結果が一意ではありません");
    assert(
      search.body.data.results[0]?.pageId === "page-099",
      "100ページ検索で目的のPageへ到達できません"
    );
    assert(
      search.elapsed <= LIMITS.searchApiMs,
      `検索APIが基準を超えました: ${Math.round(search.elapsed)}ms`
    );

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "ja-JP",
      viewport: { width: 1440, height: 900 }
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: baseUrl
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "編集" }).waitFor();

    await page.keyboard.press("Tab");
    const firstFocusedText = await page.locator(":focus").textContent();
    assert(
      firstFocusedText?.includes("本文へ移動"),
      `最初のTab操作でskip linkへ移動しません: ${firstFocusedText ?? "focusなし"}`
    );
    await page.keyboard.press("Enter");
    assert(
      await page.locator("#document-content").evaluate(
        (element) => element === document.activeElement
      ),
      "skip linkで本文へフォーカスが移動しません"
    );

    await assertA11y(page, "閲覧画面");
    assert(
      await page.getByText("100", { exact: true }).count() >= 1,
      "100ページ件数が画面へ表示されません"
    );
    assert(
      await page.getByRole("navigation", { name: "前後の文書" }).count() === 1,
      "動的閲覧画面に前後移動がありません"
    );

    await page.getByRole("button", { name: /^設定/ }).click();
    await page.getByRole("heading", { name: "設定・管理詳細" }).waitFor();
    assert(
      await page.getByText(/broken\.yaml/).count() >= 1,
      "設定画面に読み込めない文書の詳細がありません"
    );
    await assertA11y(page, "設定・読み込みの問題");
    await page.getByRole("button", { name: "文書", exact: true }).click();

    const documentTree = page.getByRole("treegrid", { name: "文書" });
    const folderLabel = documentTree.getByText("section-0", { exact: true });
    assert(await folderLabel.count() === 1, "文書ツリーのフォルダが一意ではありません");
    await folderLabel.click();
    await page.getByRole("heading", { name: "section-0", level: 1 }).waitFor();
    assert(
      await page.getByText("検証ページ 000", { exact: true }).count() >= 1,
      "フォルダ内の子文書一覧がありません"
    );
    await assertA11y(page, "フォルダ一覧");
    await page
      .getByRole("button", { name: "検証ページ 000 文書", exact: true })
      .click();
    await page.getByRole("button", { name: "編集" }).waitFor();

    const searchStarted = performance.now();
    await page.getByRole("button", { name: "全文検索を開く" }).click();
    await page.getByRole("textbox", { name: "文書を検索" }).fill("検証目印-099");
    await page.getByRole("option", { name: /検証ページ 099/ }).waitFor();
    const searchUiElapsed = performance.now() - searchStarted;
    assert(
      searchUiElapsed <= LIMITS.searchUiMs,
      `検索UIが基準を超えました: ${Math.round(searchUiElapsed)}ms`
    );
    await assertA11y(page, "検索Dialog");
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 320, height: 800 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const reflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    assert(
      reflow.scrollWidth <= reflow.clientWidth,
      `320 CSS px・文字200%で横スクロールが発生しました: ${reflow.scrollWidth}/${reflow.clientWidth}`
    );
    await assertA11y(page, "320 CSS px・文字200%");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await page.getByRole("button", { name: "編集" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor();
    await assertA11y(page, "編集画面");

    await editor.click();
    await editor.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.insertText("日本語入力");
    assert(
      (await editor.textContent())?.includes("日本語入力"),
      "日本語の確定入力を編集領域へ反映できません"
    );
    await page.getByRole("button", { name: "元に戻す" }).click();
    assert(
      !(await editor.textContent())?.includes("日本語入力"),
      "確定した日本語入力を1回のundoで取り消せません"
    );
    await page.getByRole("button", { name: "やり直す" }).click();
    assert(
      (await editor.textContent())?.includes("日本語入力"),
      "日本語入力をredoできません"
    );

    await editor.click();
    await page.evaluate(() => navigator.clipboard.writeText("貼り付け確認"));
    await page.keyboard.press("Control+V");
    assert(
      (await editor.textContent())?.includes("貼り付け確認"),
      "clipboardから本文へ貼り付けできません"
    );
    await page.waitForTimeout(200);

    await page.getByRole("button", { name: /^設定/ }).click();
    await page.getByRole("heading", { name: "未保存の変更があります" }).waitFor();
    await page.getByRole("button", { name: "編集を続ける" }).click();

    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText(/YAMLへ保存しました/).waitFor();
    const saved = await timedJson(`${baseUrl}/api/v1/pages/page-000`);
    const markdown = saved.body.data.knownBlocks[0]?.content ?? "";
    for (const expected of [
      "**太字**",
      "*強調*",
      "[リンク](https://example.com)",
      "`code`",
      "> 引用",
      "```text",
      "日本語入力",
      "貼り付け確認"
    ]) {
      assert(markdown.includes(expected), `保存後のCommonMarkに${expected}がありません`);
    }
    assert(
      /^[-*+] 項目1$/m.test(markdown),
      "保存後のCommonMarkに箇条書きがありません"
    );

    assert(
      pageErrors.length === 0,
      `ブラウザ実行中に例外が発生しました\n${pageErrors.join("\n")}`
    );
    await context.close();

    process.stdout.write([
      "Core completion verification passed",
      `- repository API (100 pages): ${Math.round(repository.elapsed)}ms / ${LIMITS.repositoryMs}ms`,
      `- search API (100 pages): ${Math.round(search.elapsed)}ms / ${LIMITS.searchApiMs}ms`,
      `- search UI (100 pages): ${Math.round(searchUiElapsed)}ms / ${LIMITS.searchUiMs}ms`,
      "- loading problems: one invalid YAML isolated and shown in settings",
      "- navigation: folder child list and previous/next links",
      "- unsaved protection: settings navigation opens discard confirmation",
      "- axe WCAG 2.2 AA: browse, settings, folder list, search dialog, edit, 320px/200%",
      "- keyboard: skip link and main focus",
      "- editor: Japanese committed input, undo/redo, paste, CommonMark round trip"
    ].join("\n") + "\n");
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        once(server, "exit"),
        new Promise((resolve) => setTimeout(resolve, 3_000))
      ]);
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function verifyNarrowTicketViews() {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.resolve("packages/vellym/dist/cli.mjs"), "dev", "--config", "how-to-use/vellym.config.yaml", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  let browser;
  try {
    await waitUntilReady(baseUrl, () => output);
    browser = await chromium.launch();
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, locale: "ja-JP" });
      await page.goto(`${baseUrl}/ja/pages/demo-tickets/`);
      for (const name of ["カンバン", "チケット一覧", "WBS"]) {
        const button = page.getByRole("button", { name, exact: true });
        await button.waitFor();
        const check = async () => {
          const doc = await page.evaluate(() => ({ width: document.scrollingElement.scrollWidth, client: document.scrollingElement.clientWidth, left: document.scrollingElement.scrollLeft }));
          assert(doc.width <= doc.client && doc.left === 0, `${width}px ${name}: document overflow ${JSON.stringify(doc)}`);
        };
        await check();
        await button.click();
        if (name === "チケット一覧" && width === 390) {
          const table = page.locator("table").first();
          await table.waitFor();
          const region = table.locator("..");
          await page.waitForFunction((el) => el.getAttribute("tabindex") === "0", await region.elementHandle());
          const caption = await table.locator("caption").textContent();
          assert(await region.getAttribute("role") === "region" && await region.getAttribute("aria-label") === caption, "表のスクロール領域に名前がありません");
          await page.evaluate(() => document.activeElement.blur());
          let reached = false;
          for (let i = 0; i < 200; i++) {
            await page.keyboard.press("Tab");
            if (await region.evaluate((el) => el === document.activeElement)) { reached = true; break; }
          }
          assert(reached, "表のスクロール領域へTabで到達できません");
          const outline = await region.evaluate((el) => getComputedStyle(el).outlineStyle);
          assert(outline !== "none", "表のフォーカスの輪がありません");
          for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
          await page.waitForTimeout(300);
          const visible = await region.evaluate((el) => {
            const regionRect = el.getBoundingClientRect();
            const last = el.querySelector("thead th:last-child").getBoundingClientRect();
            return el.scrollLeft > 0 && last.left >= regionRect.left - 1 && last.right <= regionRect.right + 1;
          });
          assert(visible, "右矢印で最後の列に到達できません");
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.waitForFunction((el) => el.scrollWidth <= el.clientWidth && !el.hasAttribute("tabindex"), await region.elementHandle());
          await page.setViewportSize({ width, height: 900 });
          await page.waitForFunction((el) => el.getAttribute("tabindex") === "0", await region.elementHandle());
        }
        if (name === "WBS") await page.locator(".wbs-row[data-ticket-name] .wbs-left").first().waitFor();
        await check();
      }
      const measure = async () => page.evaluate(() => {
        const left = document.querySelector(".wbs-row[data-ticket-name] .wbs-left").getBoundingClientRect();
        const row = document.querySelector(".wbs-row[data-ticket-name]").getBoundingClientRect();
        const buttons = [...document.querySelectorAll("button")].filter((b) => ["カンバン", "チケット一覧", "このチケット管理の設定", "WBS"].includes(b.textContent.trim())).map((b) => b.getBoundingClientRect().toJSON());
        const header = document.querySelector('[class*="document-header_"]').getBoundingClientRect();
        return { left: left.toJSON(), row: row.toJSON(), buttons, header: header.toJSON(), scroll: document.scrollingElement.scrollLeft };
      });
      const checkWbs = async () => {
        const m = await measure();
        assert(m.left.left >= 0 && m.left.right <= width && m.left.width === (width === 390 ? 168 : 400), `WBS left ${JSON.stringify(m)}`);
        assert(m.row.height === (width === 390 ? 44 : 36) && m.scroll === 0, `WBS row ${JSON.stringify(m)}`);
        assert(m.buttons.length === 4 && m.buttons.every((r) => r.height === 34 && r.left >= m.header.left && r.right <= m.header.right), `view buttons ${JSON.stringify(m)}`);
        if (width === 1280) assert(new Set(m.buttons.map((r) => r.top)).size === 1, "desktop buttons wrapped");
      };
      await checkWbs();
      await page.locator(".wbs-scroll").evaluate((el) => { el.scrollLeft = 400; el.scrollTop = 100; });
      await checkWbs();
      await page.reload();
      await page.getByRole("button", { name: "WBS", exact: true }).click();
      await page.locator(".wbs-row[data-ticket-name] .wbs-left").first().waitFor();
      await checkWbs();
      // Ticket detail (ticket-01m7k6gftnq66d3qh00knvzbnc): single-line fields two to a row from
      // 1024px, one column on phones; multi-line fields span the row; empty optional fields
      // (this ticket has no parent) appear only while editing.
      await page.goto(`${baseUrl}/ja/pages/ticket-01m0m000000000000000000001/`);
      const fields = page.locator('dl[class*="plugin-detail-fields"]');
      await fields.waitFor();
      const layout = await fields.evaluate((dl) => {
        const items = [...dl.children];
        const narrow = items.filter((item) => !item.hasAttribute("data-wide"));
        return {
          lefts: [...new Set(narrow.map((item) => Math.round(item.querySelector("dt").getBoundingClientRect().left)))],
          wide: items.filter((item) => item.hasAttribute("data-wide")).map((item) => Math.round(item.getBoundingClientRect().width)),
          width: Math.round(dl.getBoundingClientRect().width),
          labels: items.map((item) => item.querySelector("dt").textContent.trim())
        };
      });
      assert(layout.lefts.length === (width >= 1024 ? 2 : 1), `${width}px detail columns ${JSON.stringify(layout)}`);
      assert(layout.wide.length > 0 && layout.wide.every((item) => item === layout.width), `${width}px multi-line field width ${JSON.stringify(layout)}`);
      assert(!layout.labels.includes("親"), `empty optional field shown while reading ${JSON.stringify(layout)}`);
      if (width >= 1024) {
        // The phone editor does not show the field list (ticket-01m7pmtbp6s8s3cv5s1kakmjec).
        await page.getByRole("button", { name: "編集", exact: true }).click();
        await fields.locator("dt").filter({ hasText: /^親$/ }).waitFor();
        await page.getByRole("button", { name: "キャンセル", exact: true }).first().click();
      }
      await page.close();
    }
    console.log("- ticket views: narrow overflow, WBS scrolling, desktop geometry and detail field layout");
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
  }
}

await verify();
await verifyNarrowTicketViews();
await verifyGitHistory();
await verifyDocumentTreeLayout();

async function verifyGitHistory() {
  const fixture = await createFixture();
  const git = (...args) => execFileSync("git", args, { cwd: fixture.root, stdio: "pipe" });
  const original = path.join(fixture.root, "docs/content/section-0/page-000.yaml");
  const moved = path.join(fixture.root, "docs/content/section-0/moved.yaml");
  git("init"); git("config", "user.name", "History test"); git("config", "user.email", "history@example.invalid");
  git("add", "."); git("commit", "-m", "Initial document");
  await writeFile(original, pageYaml(0).replace("検証本文-000", "Committed second version"));
  git("add", "."); git("commit", "-m", "Second version");
  git("mv", "docs/content/section-0/page-000.yaml", "docs/content/section-0/moved.yaml");
  git("commit", "-m", "Move document");
  await writeFile(moved, pageYaml(0).replace("検証本文-000", "Working version " + "長い行".repeat(120)));
  const port = await availablePort(), baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.resolve("packages/vellym/dist/cli.mjs"), "dev", "--config", fixture.configPath, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "", browser;
  server.stdout.on("data", (chunk) => { output += chunk; }); server.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitUntilReady(baseUrl, () => output);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: "ja-JP" });
    for (const width of [390, 1024, 1280]) {
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error("Git browser error:", error));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${baseUrl}/ja/pages/page-000/`);
      await page.getByRole("heading", { name: "検証ページ 000", exact: true }).waitFor();
      const gitData = await timedJson(`${baseUrl}/api/v1/git/history?path=section-0%2Fmoved.yaml&limit=50`);
      assert(gitData.body.data.available, `Git fixture unavailable: ${JSON.stringify(gitData.body)}`);
      await page.getByRole("button", { name: "履歴", exact: true }).click();
      await page.getByRole("listbox").waitFor();
      assert(await page.getByRole("option").count() === 4, "未コミット+コミット3件がありません");
      await page.getByText("移動: section-0/page-000.yaml → section-0/moved.yaml", { exact: true }).waitFor();
      await page.getByRole("table").waitFor();
      assert(await page.getByRole("option").first().evaluate((el) => el === document.activeElement), "履歴一覧へ焦点が移っていません");
      await page.keyboard.press("ArrowDown");
      await page.getByText("この2つの版に違いはありません。", { exact: true }).waitFor();
      await page.getByRole("button", { name: "今との差分", exact: true }).click();
      await page.getByRole("table").waitFor();
      const overflow = await page.evaluate(() => [...document.querySelectorAll(".document-paper, main"), document.documentElement].map((el) => ({ width: el.clientWidth, scroll: el.scrollWidth })));
      assert(overflow.every((m) => m.scroll <= m.width), `Git履歴overflow ${width}: ${JSON.stringify(overflow)}`);
      await assertA11y(page, `Git履歴 ${width}`);
      await page.getByRole("button", { name: "この版を表示", exact: true }).click();
      await page.getByText("Committed second version", { exact: true }).waitFor();
      assert(await page.getByRole("button", { name: "編集", exact: true }).count() === 0, "過去版に編集が出ています");
      await page.getByRole("button", { name: "この版と今の差分", exact: true }).click();
      await page.getByRole("table").waitFor();
      await page.reload();
      await page.getByRole("listbox").waitFor();
      assert(new URL(page.url()).searchParams.has("history"), "再読み込みで履歴URLが消えました");
      await page.getByRole("button", { name: "文書に戻る", exact: true }).click();
      assert(await page.getByRole("button", { name: "履歴", exact: true }).evaluate((el) => el === document.activeElement), "履歴入口へ焦点が戻りません");
      await page.goBack(); await page.getByRole("listbox").waitFor();
      await page.goBack(); await page.getByRole("button", { name: "履歴", exact: true }).waitFor();
      await page.close();
    }
    console.log("- Git history: three commits, rename, working diff, previous/current, historical rendering, reload/back, a11y and widths 390/1024/1280");
    // Deterministic UI-only edge cases, alongside the real Git integration above.
    const envelope = (await timedJson(`${baseUrl}/api/v1/git/history?path=section-0%2Fmoved.yaml`)).body;
    const commits = Array.from({ length: 51 }, (_, i) => ({ hash: i.toString(16).padStart(40, "0"), date: "2026-11-10T12:00:00Z", author: "UI fixture", subject: `Commit ${i}` }));
    let state = "pages", fail = false;
    const edge = await context.newPage();
    await edge.setViewportSize({ width: 1280, height: 900 });
    await edge.route("**/api/v1/git/**", async (route) => {
      const url = new URL(route.request().url());
      if (fail) return route.fulfill({ status: 500, json: { error: { code: "INTERNAL", message: "failure" } } });
      let data;
      if (url.pathname.endsWith("history")) {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        data = state === "unavailable" ? { available: false, reason: "unavailable" } : {
          available: true, shallow: true, tracked: state !== "untracked", uncommitted: state === "new",
          commits: state === "pages" ? commits.slice(offset, offset + 50) : [], nextOffset: state === "pages" && offset === 0 ? 50 : null
        };
      } else if (url.pathname.endsWith("content")) data = { available: true, shallow: false, source: "[broken" };
      else data = { available: true, shallow: false, diff: state === "pages" ? `@@ -1,22 +1,22 @@\n${" context\n".repeat(10)}-old\n+new\n${" context\n".repeat(10)}` : "" };
      await route.fulfill({ json: { ...envelope, data } });
    });
    await edge.goto(`${baseUrl}/ja/pages/page-000/?history`);
    await edge.getByRole("listbox").waitFor();
    assert(await edge.getByRole("option").count() === 50, "履歴は最初の50件ではありません");
    await edge.getByRole("button", { name: "さらに表示", exact: true }).click();
    await edge.getByText("これより前の履歴は、このリポジトリに含まれていません（shallow clone）。", { exact: true }).waitFor();
    assert(await edge.getByRole("option").count() === 51, "履歴の続きを追加できません");
    await edge.getByRole("button", { name: "7行の変更なし", exact: true }).first().click();
    assert(await edge.getByRole("button", { name: "7行の変更なし", exact: true }).count() === 1, "差分を展開できません");
    await edge.getByRole("button", { name: "1列", exact: true }).click();
    await edge.reload();
    await edge.getByRole("table").waitFor();
    assert(await edge.getByRole("button", { name: "1列", exact: true }).getAttribute("aria-pressed") === "true", "差分の個人設定が保持されません");
    await edge.setViewportSize({ width: 390, height: 900 });
    assert(!await edge.getByRole("button", { name: "左右", exact: true }).isVisible(), "狭幅に差分レイアウト切替が出ています");
    await edge.getByRole("button", { name: "この版を表示", exact: true }).click();
    await edge.getByText("この版は表示できません。差分は見られます。", { exact: true }).waitFor();
    state = "new";
    await edge.reload();
    await edge.getByText("このファイルはまだコミットされていません。", { exact: true }).waitFor();
    await edge.getByText("この2つの版に違いはありません。", { exact: true }).waitFor();
    fail = true; await edge.reload();
    await edge.getByRole("alert").waitFor();
    fail = false;
    await edge.getByRole("button", { name: "再試行", exact: true }).click();
    await edge.getByRole("listbox").waitFor();
    for (state of ["unavailable", "untracked"]) {
      await edge.goto(`${baseUrl}/ja/pages/page-000/`);
      await edge.getByRole("heading", { name: "検証ページ 000", exact: true }).waitFor();
      await edge.waitForLoadState("networkidle");
      assert(await edge.getByRole("button", { name: "履歴", exact: true }).count() === 0, `${state}に履歴入口が出ています`);
    }
    await edge.close();
    console.log("- Git history edge states: 50+1 pagination, shallow, folding, layout persistence, unreadable YAML, new file, failure/retry, unavailable/untracked");
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
    await rm(fixture.root, { recursive: true, force: true });
  }
}

// Document tree and outline (ticket-01m7nyfvg2x858zvgaxhm6gyp2): saved expansion, closing from the
// tree heading and opening from the rail, one-line expand/collapse buttons at 220px and 268px in
// both UI languages, and outline links that fill their rows.
async function verifyDocumentTreeLayout() {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-tree-verify-"));
  const page = (name, title, body) => `apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: ${name}\n  title: ${title}\nspec:\n  locale: ja\n  blocks:\n    - id: body\n      type: rich-text\n      content: |\n${body.split("\n").map((line) => `        ${line}`).join("\n")}\n`;
  const headings = [
    "## 概要", "### 目的", "### 範囲", "## 文書ツリーの展開状態を保存して再読込後も同じ形で開く",
    "### 初回の展開", "### 再読込", "## 左サイドバーの開閉を文書ナビゲーションの見出し行へ移す",
    "### 閉じる", "### 開く", "## 全展開と全折りたたみのボタンを狭い幅でも一行に収める",
    "### 220px", "### 268px", "## 関連"
  ];
  const write = async (file, text) => { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text); };
  const config = (language) => write("vellym.config.yaml", `schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: ${language}\nplugins: []\n`);
  await config("ja");
  await write("content/index.yaml", page("index", "目次の確認", headings.map((heading) => `${heading}\n\n本文。`).join("\n\n")));
  await write("content/alpha/a1.yaml", page("a1", "A1", "本文"));
  await write("content/alpha/nested/n1.yaml", page("n1", "N1", "本文"));
  await write("content/beta/b1.yaml", page("b1", "B1", "本文"));
  let browser;
  const start = async () => {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, [path.resolve("packages/vellym/dist/cli.mjs"), "dev", "--config", path.join(root, "vellym.config.yaml"), "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    server.stdout.on("data", (chunk) => { output += chunk; });
    server.stderr.on("data", (chunk) => { output += chunk; });
    await waitUntilReady(baseUrl, () => output);
    return { baseUrl, stop: async () => { if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); } } };
  };
  const lines = { one: 0, more: 0 };
  try {
    browser = await chromium.launch();
    let server = await start();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ja-JP" });
      const tab = await context.newPage();
      await tab.goto(`${server.baseUrl}/ja/pages/index/`);
      const tree = tab.getByRole("treegrid");
      await tree.waitFor();
      const expanded = async () => Object.fromEntries(await tree.getByRole("row").evaluateAll((rows) => rows
        .filter((row) => row.hasAttribute("aria-expanded"))
        .map((row) => [row.textContent.trim().match(/^[a-z0-9-]+/)?.[0], row.getAttribute("aria-expanded")])));
      const state = async () => { const map = await expanded(); return { alpha: map.alpha, beta: map.beta, nested: map.nested }; };
      let now = await state();
      assert(now.alpha === "true" && now.beta === "true" && now.nested !== "true", `初回の展開がルート直下だけではありません ${JSON.stringify(await expanded())}`);
      await tab.getByRole("button", { name: "すべて折りたたむ", exact: true }).click();
      await tab.reload(); await tree.waitFor();
      now = await state();
      assert(now.alpha === "false" && now.beta === "false", `折りたたんだ状態が再読込で保たれません ${JSON.stringify(now)}`);
      // Expand with the keyboard: ArrowRight on the focused folder row.
      await tree.getByRole("row").filter({ hasText: /^beta/ }).first().focus();
      await tab.keyboard.press("ArrowRight");
      await tab.waitForFunction(() => [...document.querySelectorAll('[role="treegrid"] [role="row"][aria-expanded="true"]')].some((row) => row.textContent.trim().startsWith("beta")));
      await tab.waitForTimeout(300);
      await tab.reload(); await tree.waitFor();
      now = await state();
      assert(now.beta === "true" && now.alpha === "false", `1つだけ開いた状態が再読込で保たれません ${JSON.stringify(await expanded())}`);

      // Open and close: from the tree heading and the rail, by pointer and by keyboard.
      const nav = tab.locator('aside[aria-label="文書ナビゲーション"]');
      const closeButton = tab.getByRole("button", { name: "文書ナビゲーションを閉じる" });
      const openButton = tab.getByRole("button", { name: "文書ナビゲーションを開く" });
      await closeButton.click();
      await tab.waitForFunction(() => document.querySelector('aside[aria-label="文書ナビゲーション"]')?.getAttribute("aria-hidden") === "true" || !document.querySelector('aside[aria-label="文書ナビゲーション"]'));
      await openButton.click();
      await nav.waitFor();
      await closeButton.focus(); await tab.keyboard.press("Enter");
      await openButton.waitFor();
      await openButton.focus(); await tab.keyboard.press("Enter");
      await closeButton.waitFor();
      assert(await tab.locator("header").getByRole("button", { name: /^文書ナビゲーション/ }).filter({ visible: true }).count() === 0, "ヘッダーに文書ナビゲーションの開閉ボタンがあります");
      const widthCheck = async (labels, language) => {
        const separator = tab.getByRole("separator", { name: /^(文書ナビゲーションの幅|Document navigation width)$/ });
        for (const target of [268, 220]) {
          await separator.focus();
          for (let i = 0; i < 40 && Number(await separator.getAttribute("aria-valuenow")) > target; i++) await tab.keyboard.press("ArrowLeft");
          for (let i = 0; i < 40 && Number(await separator.getAttribute("aria-valuenow")) < target; i++) await tab.keyboard.press("ArrowRight");
          assert(Number(await separator.getAttribute("aria-valuenow")) === target, `${language} ツリーの幅を${target}pxにできません`);
          for (const label of labels) {
            const fit = await tab.getByRole("button", { name: label, exact: true }).evaluate((el) => {
              const style = getComputedStyle(el);
              const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
              const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
              const panel = el.closest("aside").getBoundingClientRect();
              const rect = el.getBoundingClientRect();
              return { scroll: el.scrollWidth, client: el.clientWidth, height: rect.height, limit: (line * 1.5) + padding, right: rect.right, panelRight: panel.right };
            });
            assert(fit.scroll <= fit.client && fit.height < fit.limit, `${language} ${target}px「${label}」が1行に収まりません ${JSON.stringify(fit)}`);
            assert(fit.right <= fit.panelRight + 0.5, `${language} ${target}px「${label}」がツリーの端からはみ出しています ${JSON.stringify(fit)}`);
          }
        }
      };
      await widthCheck(["すべて展開", "すべて折りたたむ"], "ja");

      // Outline: each link fills its row (no empty column), and count one-line and wrapped rows.
      const outline = await tab.evaluate(() => [...document.querySelectorAll("nav ol li > a")].map((a) => {
        const li = a.closest("li");
        const style = getComputedStyle(li);
        const inner = li.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const own = getComputedStyle(a);
        const line = parseFloat(own.lineHeight) || parseFloat(own.fontSize) * 1.5;
        const content = a.getBoundingClientRect().height - parseFloat(own.paddingTop) - parseFloat(own.paddingBottom) - parseFloat(own.borderTopWidth) - parseFloat(own.borderBottomWidth);
        return { gap: Math.abs(a.getBoundingClientRect().width - inner), lines: Math.round(content / line), line, content };
      }));
      assert(outline.length >= 12, `目次の行が足りません ${outline.length}`);
      assert(outline.every((item) => item.gap <= 1), `目次のリンクが行の幅を埋めていません ${JSON.stringify(outline)}`);
      lines.one = outline.filter((item) => item.lines <= 1).length;
      lines.more = outline.length - lines.one;
      await context.close();
    } finally { await server.stop(); }

    await config("en");
    server = await start();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
      const tab = await context.newPage();
      await tab.goto(`${server.baseUrl}/ja/pages/index/`);
      await tab.getByRole("treegrid").waitFor();
      const separator = tab.getByRole("separator", { name: /width/i });
      for (const target of [268, 220]) {
        await separator.focus();
        for (let i = 0; i < 40 && Number(await separator.getAttribute("aria-valuenow")) > target; i++) await tab.keyboard.press("ArrowLeft");
        for (let i = 0; i < 40 && Number(await separator.getAttribute("aria-valuenow")) < target; i++) await tab.keyboard.press("ArrowRight");
        for (const label of ["Expand all", "Collapse all"]) {
          const fit = await tab.getByRole("button", { name: label, exact: true }).evaluate((el) => {
            const style = getComputedStyle(el);
            const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
            const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
            const panel = el.closest("aside").getBoundingClientRect();
            const rect = el.getBoundingClientRect();
            return { scroll: el.scrollWidth, client: el.clientWidth, height: rect.height, limit: (line * 1.5) + padding, right: rect.right, panelRight: panel.right };
          });
          assert(fit.scroll <= fit.client && fit.height < fit.limit, `en ${target}px "${label}" does not fit on one line ${JSON.stringify(fit)}`);
          assert(fit.right <= fit.panelRight + 0.5, `en ${target}px "${label}" runs past the tree edge ${JSON.stringify(fit)}`);
        }
      }
      await context.close();
    } finally { await server.stop(); }
    console.log(`- document tree: saved expansion, close from heading / open from rail (pointer and keyboard), one-line expand/collapse at 220px and 268px (ja, en), outline rows fill (${lines.one} one-line, ${lines.more} wrapped)`);
  } finally {
    if (browser) await browser.close();
    await rm(root, { recursive: true, force: true });
  }
}
