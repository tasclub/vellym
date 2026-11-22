// Scenario modules export steps = [{ id, title, run(ctx) }]. No product data is used.
import childProcess, { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { syncBuiltinESMExports } from "node:module";
import { chromium, expect } from "@playwright/test";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "packages/vellym/dist/cli.mjs");
const output = path.join(repository, "dist/acceptance");
const scriptPath = fileURLToPath(import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const statuses = ["PASS", "FAIL", "BLOCKED", "NOT RUN"];

function options(args) {
  const result = { files: [], directory: path.join(repository, "scripts/acceptance"), timeout: 600_000 };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--file") result.files.push(value);
    else if (flag === "--dir") result.directory = path.resolve(value);
    else if (flag === "--worker") result.worker = path.resolve(value);
    else if (flag === "--step-timeout-ms" && Number.isSafeInteger(Number(value)) && Number(value) > 0) result.timeout = Number(value);
    else throw new Error(`Invalid option: ${flag} ${value}`);
  }
  return result;
}

// Always signal the group, even after its leader exits: grandchildren can ignore TERM.
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
async function stopGroup(pid) {
  signalGroup(pid, "SIGTERM");
  await delay(5_000);
  signalGroup(pid, "SIGKILL");
}
async function bounded(run, ms) {
  let timer;
  try { return await Promise.race([run(), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Cleanup timed out after ${ms}ms`)), ms);
  })]); } finally { clearTimeout(timer); }
}

async function launchBrowserInWorkerGroup() {
  // Playwright normally spawns with detached:true. Enforce this worker's process
  // group during launch, without changing its browser binary, arguments or CDP
  // transport. This is worker-local and steps/launches are strictly sequential.
  // Restore the built-in immediately, including when launch fails.
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = (executable, args, options) => originalSpawn(executable, args, { ...options, detached: false });
  syncBuiltinESMExports();
  try { return await chromium.launch({ headless: true }); }
  finally { childProcess.spawn = originalSpawn; syncBuiltinESMExports(); }
}

async function parent(opts) {
  const files = (await fs.readdir(opts.directory)).filter((file) => file.endsWith(".mjs")).sort();
  const unknown = opts.files.filter((name) => !files.includes(`${name}.mjs`));
  if (unknown.length) throw new Error(`Unknown module: ${unknown.join(", ")}. Available: ${files.map((f) => f.slice(0, -4)).join(", ")}`);
  const selected = files.filter((file) => !opts.files.length || opts.files.includes(file.slice(0, -4)));
  const results = [];
  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[^0-9]/g, "");
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).stdout?.trim() ?? "";
  let running = null, complete = false, interrupted = false, active;
  // Synchronous atomic replacement also makes signal-time snapshots reliable.
  const { writeFileSync, renameSync } = await import("node:fs");
  const writeResult = () => {
    const summary = Object.fromEntries(statuses.map((status) => [status, results.filter((r) => r.status === status).length]));
    const destination = path.join(output, "result.json");
    const temporary = `${destination}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({
      commit, executedAt: new Date().toISOString(), runId, startedAt,
      filter: opts.files, complete, running, ...(interrupted ? { interrupted: true } : {}), summary, results
    }, null, 2) + "\n");
    renameSync(temporary, destination);
  };
  const onSignal = () => {
    if (interrupted) return;
    interrupted = true;
    writeResult();
    active?.interrupt();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  writeResult();
  try {
    const ids = new Set();
    for (const file of selected) {
      if (interrupted) break;
      const modulePath = path.join(opts.directory, file);
      let steps;
      try {
        ({ steps } = await import(pathToFileURL(modulePath).href));
        if (!Array.isArray(steps) || !steps.length) throw new Error("Module must export nonempty steps");
        for (const step of steps) {
          if (!step.id || ids.has(step.id) || typeof step.run !== "function") throw new Error("Invalid or duplicate step");
          ids.add(step.id);
        }
      } catch (error) {
        results.push({ id: file, status: "FAIL", detail: String(error), durationMs: 0 });
        writeResult();
        continue;
      }
      if (interrupted) break;
      await new Promise((resolve) => {
        const child = spawn(process.execPath, [scriptPath, "--worker", modulePath], {
          cwd: repository, detached: true, stdio: ["ignore", "pipe", "pipe"]
        });
        let timer, terminating, current, currentStart;
        const completed = new Set(), warnings = [];
        const finish = async (reason) => {
          if (terminating) return terminating;
          clearTimeout(timer);
          const elapsed = Math.round(performance.now() - (currentStart ?? launched));
          terminating = (async () => {
            // Wait for escalation even if the worker exits first.
            await stopGroup(child.pid);
            if (reason && !interrupted) {
              const step = current ?? steps.find((s) => !completed.has(s.id));
              if (step) {
                results.push({ id: step.id, status: "FAIL", detail: { title: step.title, checks: [], notes: [`期限切れ: ${elapsed}ms (${reason})`, ...warnings] }, durationMs: elapsed });
                completed.add(step.id);
                console.log(`✔ FAIL ${step.id} ${(elapsed / 1000).toFixed(1)}s`);
              } else {
                results.push({ id: `${file}:cleanup`, status: "FAIL", detail: `期限切れ: ${elapsed}ms (${reason})`, durationMs: elapsed });
              }
              for (const remaining of steps.filter((s) => !completed.has(s.id))) {
                results.push({ id: remaining.id, status: "NOT RUN", detail: { title: remaining.title, checks: [], notes: ["前の手順の期限切れ"] }, durationMs: 0 });
              }
            }
            running = null;
            resolve();
          })();
          return terminating;
        };
        active = { interrupt: () => finish() };
        const launched = performance.now();
        const reset = () => {
          clearTimeout(timer);
          if (!terminating && !interrupted) timer = setTimeout(() => { void finish(`no worker line for ${opts.timeout}ms`); }, opts.timeout);
        };
        reset();
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
          if (terminating || interrupted) return;
          reset();
          let event;
          try { event = JSON.parse(line); } catch { warnings.push(`worker stdout: ${line}`); return; }
          if (event.event === "start") {
            current = steps.find((s) => s.id === event.id);
            currentStart = performance.now();
            running = event.id;
            console.log(`▶ ${event.id}`);
            writeResult();
          } else if (event.event === "end" && current?.id === event.id && statuses.includes(event.status)) {
            const { id, status, detail, durationMs } = event;
            detail.notes.push(...warnings.splice(0));
            results.push({ id, status, detail, durationMs });
            completed.add(id);
            current = undefined;
            running = null;
            console.log(`✔ ${status} ${id} ${(durationMs / 1000).toFixed(1)}s`);
            writeResult();
          } else if (event.event === "cleanup") {
            const last = results.at(-1);
            // In-step server warnings are already included by the worker's end event.
            if (!current && last?.detail?.notes) last.detail.notes.push(event.detail);
            if (event.status === "FAIL") results.push({ id: `${file}:cleanup`, status: "FAIL", detail: event.detail, durationMs: 0 });
          } else warnings.push(`worker stdout: ${line}`);
        });
        child.stderr.on("data", (chunk) => { warnings.push(`worker stderr: ${chunk.toString()}`); });
        child.on("error", (error) => { warnings.push(String(error)); });
        child.on("close", (code, signal) => {
          clearTimeout(timer);
          if (terminating) return;
          // Unexpected worker termination must not silently omit remaining scenarios.
          if (completed.size < steps.length && !current) {
            results.push({ id: `${file}:worker`, status: "FAIL", detail: `Worker exited before completing scenarios (${code ?? signal})`, durationMs: 0 });
          }
          for (const step of steps.filter((s) => !completed.has(s.id))) {
            results.push({ id: step.id, status: step.id === current?.id ? "FAIL" : "NOT RUN",
              detail: { title: step.title, checks: [], notes: [`Worker exited (${code ?? signal})`, ...warnings] }, durationMs: 0 });
          }
          if ((code || signal) && completed.size === steps.length) results.push({ id: `${file}:worker`, status: "FAIL", detail: `Worker exited (${code ?? signal})`, durationMs: 0 });
          if (warnings.length && results.at(-1)?.detail?.notes) results.at(-1).detail.notes.push(...warnings);
          running = null;
          // Remove any leaked descendants even on normal completion.
          void finish();
        });
      });
      active = undefined;
      writeResult();
    }
    complete = !interrupted;
  } catch (error) {
    results.push({ id: "runner", status: "FAIL", detail: error.stack ?? String(error), durationMs: 0 });
  } finally {
    running = null;
    writeResult();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  console.table(results.map(({ id, status, durationMs }) => ({ id, status, durationMs })));
  console.log(`Evidence: ${path.join(output, "result.json")}`);
  process.exitCode = interrupted ? 130 : (!results.length || results.some((r) => r.status === "FAIL") || !complete ? 1 : 0);
}

async function worker(modulePath) {
await fs.mkdir(output, { recursive: true });
const results = [];
const cleanups = [];
const state = {};
let browser;
let notes = [];
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const command = (cwd, executable, args) => {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};
const ctx = {
  fs, path, expect, state, repository, output,
  command,
  cli: (cwd, ...args) => command(cwd, process.execPath, [cli, ...args]),
  git: (cwd, ...args) => {
    const result = command(cwd, "git", args);
    expect(result.status, `git ${args.join(" ")}: ${result.stderr}`).toBe(0);
    return result.stdout.trim();
  },
  async temporary(prefix = "project") {
    const root = await fs.mkdtemp(path.join(tmpdir(), `vellym-acceptance-${prefix}-`));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    return root;
  },
  async write(root, file, text) {
    const destination = path.resolve(root, file);
    if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Write outside temporary root");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, text);
  },
  async start(root, options = {}) {
    let port = options.port;
    if (port === undefined) {
      const socket = createServer();
      socket.listen(0, "127.0.0.1");
      await once(socket, "listening");
      port = socket.address().port;
      await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
    }
    const origin = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, [cli, "dev", "--host", "127.0.0.1", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    server.stdout.on("data", (chunk) => { log += chunk; });
    server.stderr.on("data", (chunk) => { log += chunk; });
    const stop = async () => {
      if (server.exitCode !== null || server.signalCode !== null) return;
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      let timer;
      const killed = await Promise.race([exited.then(() => false), new Promise((resolve) => { timer = setTimeout(() => resolve(true), 5_000); })]);
      clearTimeout(timer);
      if (killed) {
        const warning = "dev server did not stop within 5000ms after SIGTERM; sent SIGKILL";
        notes.push(warning);
        emit({ event: "cleanup", status: "WARN", detail: warning });
        server.kill("SIGKILL");
        await exited;
      }
    };
    cleanups.push(stop);
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(`${origin}/api/v1/bootstrap`)).ok) break; } catch {}
      if (attempt >= 150 || server.exitCode !== null) throw new Error(`Server unavailable: ${log}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { origin, server, stop, log: () => log };
  },
  async page(origin) {
    browser ??= await launchBrowserInWorkerGroup();
    const context = await browser.newContext({ locale: "ja-JP", viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(5_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    return context.newPage();
  },
  async json(origin, endpoint) {
    const response = await fetch(`${origin}/api/v1/${endpoint}`);
    expect(response.ok, `${endpoint}: HTTP ${response.status}`).toBe(true);
    return (await response.json()).data;
  },
  blocked(reason) { const error = new Error(reason); error.blocked = true; throw error; }
};

// Per-check outcomes remain in detail even if a later operation throws. A partially
// exercised scenario never becomes PASS just because the last assertion succeeded.
try {
  const files = [modulePath];
  const ids = new Set();
  for (const file of files) {
    let steps;
    try {
      ({ steps } = await import(pathToFileURL(file).href));
      if (!Array.isArray(steps) || !steps.length) throw new Error("Module must export nonempty steps");
    } catch (error) {
      emit({ event: "cleanup", status: "FAIL", detail: String(error) });
      continue;
    }
    for (const step of steps) {
      emit({ event: "start", id: step.id });
      const start = performance.now();
      const checks = [];
      let status = "PASS";
      notes = [];
      ctx.check = async (title, run) => {
        try { await run(); checks.push({ title, status: "PASS" }); return true; }
        catch (error) {
          const evidence = `${step.id}-${checks.length + 1}`;
          if (ctx.state.page && !ctx.state.page.isClosed()) {
            await ctx.state.page.screenshot({ path: path.join(output, `${evidence}.png`), fullPage: true }).catch(() => {});
            await fs.writeFile(path.join(output, `${evidence}.html`), await ctx.state.page.content()).catch(() => {});
          }
          checks.push({ title, status: error.blocked ? "BLOCKED" : "FAIL", detail: error.message, evidence }); return false;
        }
      };
      ctx.note = (text) => notes.push(text);
      try {
        if (!step.id || ids.has(step.id) || typeof step.run !== "function") throw new Error("Invalid or duplicate step");
        ids.add(step.id);
        const result = await step.run(ctx);
        if (result?.status) {
          if (!["PASS", "FAIL", "BLOCKED", "NOT RUN"].includes(result.status)) throw new Error("Invalid status");
          status = result.status;
          if (result.detail) notes.push(result.detail);
        }
      } catch (error) {
        status = error.blocked ? "BLOCKED" : "FAIL";
        notes.push(error.stack ?? String(error));
        notes.push("この例外より後の確認は未実行。前提の失敗を直して再実行する必要があります。");
        if (ctx.state.page && !ctx.state.page.isClosed()) {
          await ctx.state.page.screenshot({ path: path.join(output, `${step.id}.png`), fullPage: true }).catch(() => {});
        }
      }
      if (checks.some((check) => check.status === "FAIL")) status = "FAIL";
      else if (checks.some((check) => check.status === "BLOCKED") && status === "PASS") status = "BLOCKED";
      if (["BLOCKED", "NOT RUN"].includes(status) && !notes.length && !checks.some((check) => check.detail)) notes.push("No executable evidence was produced");
      if (ctx.state.page && !ctx.state.page.isClosed()) {
        await ctx.state.page.screenshot({ path: path.join(output, `${step.id}.png`), fullPage: true }).catch(() => {});
      }
      results.push({ id: step.id, status, detail: { title: step.title, checks, notes }, durationMs: Math.round(performance.now() - start) });
      emit({ event: "end", ...results.at(-1) });
    }
  }
} catch (error) {
  emit({ event: "cleanup", status: "FAIL", detail: error.stack ?? String(error) });
} finally {
   if (browser) {
     try { await bounded(() => browser.close(), 30_000); }
     catch (error) { emit({ event: "cleanup", status: "FAIL", detail: String(error) }); }
   }
  for (const cleanup of cleanups.reverse()) {
    try { await bounded(cleanup, 30_000); } catch (error) { emit({ event: "cleanup", status: "FAIL", detail: String(error) }); }
  }
  // A cleanup that timed out cannot keep the worker alive indefinitely.
  process.exitCode = 0;
}
}

try {
  const opts = options(process.argv.slice(2));
  await fs.mkdir(output, { recursive: true });
  if (opts.worker) {
    await worker(opts.worker);
    await new Promise((resolve) => process.stdout.write("", resolve));
    process.exit(process.exitCode ?? 0);
  }
  else await parent(opts);
} catch (error) {
  console.error(String(error), "\nUsage: node scripts/verify-acceptance.mjs [--file core-a] [--file ticket-a] [--step-timeout-ms 600000] [--dir directory]");
  process.exitCode = 2;
}
