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
