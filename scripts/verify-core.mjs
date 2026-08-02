import { spawn } from "node:child_process";
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

await verify();
