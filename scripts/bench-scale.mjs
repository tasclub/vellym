// 規模計測。宣言した最低動作要件のもとで、起動時間・常駐メモリ・応答時間を測る。
//
// 開発者のローカルで測っても他の環境を代表しないため、資源上限を課したコンテナで実行する前提。
//   docker run --memory=4g --cpus=2 ... node scripts/bench-scale.mjs --config <fixture>/vellym.config.yaml
//
// 測るもの
//   - 起動から /api/v1/bootstrap が ready になるまでの時間
//   - サーバプロセスの常駐メモリ（VmRSS）と最大値（VmHWM）
//   - GET /api/v1/repository の応答時間と本文サイズ
//   - GET /api/v1/search の応答時間（初回と再実行）
//   - GET /api/v1/pages/:id と PATCH の往復時間
// --tickets: PlaywrightでTicket 1,000件の一覧・絞り込み・カンバン・保存・
// WBS・縦スクロール・詳細を測る（既定3回、新規サーバ/context、最大値判定）。
//   npm run verify:scale:tickets

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const configPath = path.resolve(
  option(args, "--config") ?? "bench-fixture/vellym.config.yaml"
);
const port = Number(option(args, "--port") ?? "4173");
const label = option(args, "--label") ?? "bench";
const outPath = option(args, "--out");
const assertThresholds = args.includes("--assert");
const readyTimeoutMs = Number(option(args, "--ready-timeout") ?? "1800000");
const cli = path.resolve(
  option(args, "--cli") ?? "packages/vellym/dist/cli.mjs"
);

const base = `http://127.0.0.1:${port}`;
const origin = base;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// /proc から読む。Linuxコンテナ内での実行を前提とする。
async function memoryKb(pid) {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const rss = /VmRSS:\s+(\d+) kB/.exec(status);
    const peak = /VmHWM:\s+(\d+) kB/.exec(status);
    return {
      rssKb: rss ? Number(rss[1]) : null,
      peakRssKb: peak ? Number(peak[1]) : null
    };
  } catch {
    return { rssKb: null, peakRssKb: null };
  }
}

// 巨大な応答を文字列へ載せるとベンチ側が落ちるため、読み捨てながらバイト数だけ数える。
async function timedDrain(url, init) {
  const started = performance.now();
  const response = await fetch(url, init);
  let bytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
  }
  return {
    ms: Math.round(performance.now() - started),
    status: response.status,
    bytes
  };
}

async function timedJson(url, init) {
  const started = performance.now();
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    ms: Math.round(performance.now() - started),
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}

// Ticket mode uses the real browser and fresh server/context for each sample.
// It deliberately waits for view-specific DOM, not for the view-switch click.
async function benchTickets() {
  const { chromium, expect } = await import("@playwright/test");
  const runs = Number(option(args, "--runs") ?? "3");
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be positive");
  // Rounded ceilings with headroom over three local cold runs; see the Ticket's
  // execution record. These are CI regression budgets, not hardware-independent SLAs.
  const limitsMs = { startupList: 5000, filter: 1000, kanban: 1000,
    moveSave: 2000, wbs: 1500, scroll: 500, detail: 2000 };
  const samples = [];
  const browser = await chromium.launch();
  try {
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({ locale: "ja-JP", viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let log = "", exited = false;
      const start = performance.now();
      const server = spawn(process.execPath, [cli, "dev", "--config", configPath,
        "--host", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
      server.stdout.on("data", (data) => { log += data; });
      server.stderr.on("data", (data) => { log += data; });
      server.on("exit", () => { exited = true; });
      const serverError = new Promise((_, reject) => server.once("error", reject));
      // Two animation frames leave one paint opportunity after React commits.
      const paint = () => page.evaluate(() => new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const measure = async (action) => {
        const at = performance.now();
        await action(); await paint();
        return Math.round(performance.now() - at);
      };
      try {
        await Promise.race([serverError, (async () => {
          while (performance.now() - start < Math.min(readyTimeoutMs, 120000)) {
            if (exited) throw new Error(`Ticket server exited: ${log}`);
            try {
              const response = await fetch(`${base}/api/v1/bootstrap`);
              if (response.ok && (await response.json()).data?.state === "ready") return;
            } catch { /* not listening yet */ }
            await sleep(100);
          }
          throw new Error(`Ticket server readiness timeout: ${log}`);
        })()]);
        await page.goto(`${base}/ja/bench-tracker`);
        const table = page.locator(".plugin-list table");
        await expect(table).toBeVisible();
        await expect(table.getByRole("button", { name: "Benchmark ticket 0000", exact: true })).toBeVisible();
        await paint();
        const sample = { startupList: Math.round(performance.now() - start) };
        await page.locator('[aria-controls="plugin-list-filter-controls"]').click();
        sample.filter = await measure(async () => {
          await page.locator("#plugin-filter-status").selectOption("doing");
          await expect(table.getByRole("button", { name: "Benchmark ticket 0003", exact: true })).toHaveCount(0);
          await expect(table.getByRole("button", { name: "Benchmark ticket 0001", exact: true })).toBeVisible();
          // Every rendered data row must now have the selected status.
          await expect.poll(() => table.locator("tbody tr").count()).toBeGreaterThan(0);
          for (const text of await table.locator("tbody tr").allTextContents()) {
            if (!text.includes("Doing")) throw new Error(`Unfiltered row: ${text}`);
          }
        });
        sample.kanban = await measure(async () => {
          await page.getByRole("group", { name: "表示", exact: true }).getByRole("button", { name: "カンバン", exact: true }).click();
          await expect(page.locator('article[data-ticket-name="bench-ticket-0000"]')).toBeVisible();
        });
        // Use the documented keyboard card move; persist alternates across runs.
        const card = page.locator('article[data-ticket-name="bench-ticket-0000"]');
        const file = path.join(path.dirname(configPath), "content/+tickets/bench-ticket-0000.yaml");
        const source = await readFile(file, "utf8");
        const fromDoing = /status: doing/.test(source);
        const target = fromDoing ? "todo" : "doing";
        sample.moveSave = await measure(async () => {
          const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("bench-ticket-0000"));
          await card.getByRole("button", { name: "Benchmark ticket 0000", exact: true }).press(fromDoing ? "Alt+ArrowLeft" : "Alt+ArrowRight");
          const response = await saved;
          if (!response.ok()) throw new Error(`Card save failed: ${response.status()}`);
          await expect.poll(() => readFile(file, "utf8")).toMatch(new RegExp(`status: ${target}\\b`));
          await expect(page.locator(`#kanban-defined-${target}`).locator("..").locator('[data-ticket-name="bench-ticket-0000"]')).toHaveAttribute("aria-busy", "false");
        });
        sample.wbs = await measure(async () => {
          await page.getByRole("group", { name: "表示", exact: true }).getByRole("button", { name: "WBS", exact: true }).click();
          // 1000 tickets + header row + the "add task" row (role="row") added by inline quick add.
          await expect(page.getByRole("treegrid", { name: "WBSの階層" })).toHaveAttribute("aria-rowcount", "1002");
          await expect(page.locator('.wbs-row[data-ticket-name="bench-ticket-0000"]')).toBeVisible();
        });
        const firstName = await page.locator(".wbs-row[data-ticket-name]").first().getAttribute("data-ticket-name");
        await page.locator(".wbs-scroll").scrollIntoViewIfNeeded();
        sample.scroll = await measure(async () => {
          const scroll = page.locator(".wbs-scroll");
          await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight - element.clientHeight; });
          await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
          await expect(page.locator(`.wbs-row[data-ticket-name="${firstName}"]`)).not.toBeInViewport();
          await expect(page.locator('.wbs-row[data-ticket-name="bench-ticket-0999"]')).toBeInViewport();
        });
        sample.detail = await measure(async () => {
          await page.locator('.wbs-row[data-ticket-name="bench-ticket-0999"] .wbs-title').click();
          await expect(page.getByText("Benchmark description 999", { exact: true })).toBeVisible();
        });
        if (errors.length) throw new Error(errors.join("\n"));
        samples.push(sample);
      } finally {
        await context.close();
        const stopped = new Promise((resolve) => server.once("exit", resolve));
        server.kill("SIGTERM");
        if (!exited) await Promise.race([stopped, sleep(2000)]);
        if (!exited) { server.kill("SIGKILL"); await stopped; }
      }
    }
  } finally { await browser.close(); }
  const maxMs = Object.fromEntries(Object.keys(limitsMs).map((key) => [key, Math.max(...samples.map((s) => s[key]))]));
  const result = { label, tickets: 1000, samples, maxMs, limitsMs };
  const text = `${JSON.stringify(result, null, 2)}\n`;
  process.stdout.write(text);
  if (outPath) await writeFile(path.resolve(outPath), text);
  if (assertThresholds) {
    const failures = Object.keys(limitsMs).filter((key) => maxMs[key] > limitsMs[key]);
    if (failures.length) throw new Error(`Ticket scale verification failed: ${failures.map((key) => `${key} ${maxMs[key]}ms > ${limitsMs[key]}ms`).join(", ")}`);
  }
}

if (args.includes("--tickets")) {
  await benchTickets();
} else {
const child = spawn(
  process.execPath,
  [cli, "dev", "--config", configPath, "--host", "127.0.0.1", "--port", String(port)],
  { stdio: ["ignore", "pipe", "pipe"] }
);

let serverLog = "";
child.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

let exited = null;
child.on("exit", (code, signal) => {
  exited = { code, signal };
});

// 起動中も定期的にメモリを見る。構築の山は起動時に出る。
let samplePeakKb = 0;
const sampler = setInterval(async () => {
  const { rssKb } = await memoryKb(child.pid);
  if (rssKb && rssKb > samplePeakKb) samplePeakKb = rssKb;
}, 250);

const startedAt = performance.now();
let readyMs = null;
let bootstrap = null;

try {
  while (performance.now() - startedAt < readyTimeoutMs) {
    if (exited) {
      throw new Error(
        `server exited before ready (code=${exited.code} signal=${exited.signal})\n${serverLog}`
      );
    }
    try {
      const response = await fetch(`${base}/api/v1/bootstrap`);
      if (response.ok) {
        const payload = await response.json();
        if (payload?.data?.state === "ready") {
          readyMs = Math.round(performance.now() - startedAt);
          bootstrap = payload.data;
          break;
        }
      }
    } catch {
      // まだlistenしていない。
    }
    await sleep(200);
  }

  if (readyMs === null) throw new Error(`server did not become ready\n${serverLog}`);

  const afterStartup = await memoryKb(child.pid);

  const repository = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    repository.push(await timedDrain(`${base}/api/v1/repository`));
  }

  // 出現頻度の異なる語を混ぜる。1件だけ当たる語は「全走査して1件」の最悪形になる。
  const queries = ["認証基盤", "移行手順", "識別子 ticket-000010-b1", "存在しない語彙xyzzy"];
  const search = [];
  for (const query of queries) {
    const first = await timedJson(
      `${base}/api/v1/search?q=${encodeURIComponent(query)}`
    );
    const second = await timedJson(
      `${base}/api/v1/search?q=${encodeURIComponent(query)}`
    );
    search.push({
      query,
      firstMs: first.ms,
      repeatMs: second.ms,
      total: first.body?.data?.total ?? null,
      indexedPages: first.body?.data?.indexedPages ?? null
    });
  }

  const pageId = "ticket-000010";
  const pageRead = await timedJson(`${base}/api/v1/pages/${pageId}`);
  let save = null;
  if (pageRead.status === 200 && pageRead.body?.data?.hash) {
    const view = pageRead.body.data;
    const block = view.knownBlocks?.[0];
    save = await timedJson(`${base}/api/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        baseHash: view.hash,
        ...(block
          ? { richTextBlocks: [{ id: block.id, content: `${block.content}\n\n計測による追記。` }] }
          : {})
      })
    });
  }

  const afterWork = await memoryKb(child.pid);

  const result = {
    label,
    configPath,
    locales: bootstrap?.project?.availableLocales ?? null,
    startup: {
      readyMs,
      rssMbAfterStartup: afterStartup.rssKb
        ? Math.round(afterStartup.rssKb / 1024)
        : null
    },
    memory: {
      rssMbAfterWork: afterWork.rssKb ? Math.round(afterWork.rssKb / 1024) : null,
      peakRssMb: afterWork.peakRssKb
        ? Math.round(afterWork.peakRssKb / 1024)
        : Math.round(samplePeakKb / 1024)
    },
    repository: {
      firstMs: repository[0].ms,
      repeatMs: repository.slice(1).map((item) => item.ms),
      bytes: repository[0].bytes,
      megabytes: Math.round((repository[0].bytes / 1024 / 1024) * 10) / 10
    },
    search,
    pageRead: { ms: pageRead.ms, status: pageRead.status },
    save: save ? { ms: save.ms, status: save.status } : null
  };
  const text = `${JSON.stringify(result, null, 2)}\n`;
  process.stdout.write(text);
  if (outPath) await writeFile(path.resolve(outPath), text, "utf8");
  if (assertThresholds) {
    const failures = [];
    if (!save || save.status !== 200 || save.ms >= 1000) {
      failures.push(`save must be <1000ms (actual: ${save?.ms ?? "missing"}ms)`);
    }
    const slowestSearch = Math.max(
      ...search.flatMap((item) => [item.firstMs, item.repeatMs])
    );
    if (slowestSearch >= 100) {
      failures.push(`search must be <100ms (actual max: ${slowestSearch}ms)`);
    }
    if (failures.length) throw new Error(`scale verification failed:\n- ${failures.join("\n- ")}`);
  }
} finally {
  clearInterval(sampler);
  child.kill("SIGTERM");
  await sleep(300);
  if (!exited) child.kill("SIGKILL");
}
}
