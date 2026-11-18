// Scenario modules export steps = [{ id, title, run(ctx) }]. No product data is used.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "packages/vellym/dist/cli.mjs");
const output = path.join(repository, "dist/acceptance");
await fs.mkdir(output, { recursive: true });
const results = [];
const cleanups = [];
const state = {};
let browser;
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
  async start(root) {
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
    const origin = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, [cli, "dev", "--host", "127.0.0.1", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    server.stdout.on("data", (chunk) => { log += chunk; });
    server.stderr.on("data", (chunk) => { log += chunk; });
    const stop = async () => {
      if (server.exitCode !== null) return;
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
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
    browser ??= await chromium.launch({ headless: true });
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
  const directory = path.join(repository, "scripts/acceptance");
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".mjs")).sort();
  const ids = new Set();
  for (const file of files) {
    let steps;
    try {
      ({ steps } = await import(pathToFileURL(path.join(directory, file)).href));
      if (!Array.isArray(steps) || !steps.length) throw new Error("Module must export nonempty steps");
    } catch (error) {
      results.push({ id: file, status: "FAIL", detail: String(error), durationMs: 0 });
      continue;
    }
    for (const step of steps) {
      const start = performance.now();
      const checks = [];
      let status = "PASS";
      const notes = [];
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
    }
  }
} catch (error) {
  results.push({ id: "runner", status: "FAIL", detail: error.stack ?? String(error), durationMs: 0 });
} finally {
  await browser?.close();
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); } catch (error) { results.push({ id: "cleanup", status: "FAIL", detail: String(error), durationMs: 0 }); }
  }
  const commit = command(repository, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const summary = Object.fromEntries(["PASS", "FAIL", "BLOCKED", "NOT RUN"].map((status) => [status, results.filter((item) => item.status === status).length]));
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ commit, executedAt: new Date().toISOString(), summary, results }, null, 2) + "\n");
  console.table(results.map(({ id, status, durationMs }) => ({ id, status, durationMs })));
  console.log(summary, `\nEvidence: ${path.join(output, "result.json")}`);
  if (!results.length || summary.FAIL) process.exitCode = 1;
}
