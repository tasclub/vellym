import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repository = process.cwd();
const resultPath = path.join(repository, "dist/acceptance/result.json");
const fixtureDirectory = path.join(repository, "tests/fixtures/acceptance-runner");
const children = new Set<ChildProcess>();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function snapshot() { return JSON.parse(await readFile(resultPath, "utf8")); }
function launch(...args: string[]) {
  const child = spawn(process.execPath, ["scripts/verify-acceptance.mjs", "--dir", fixtureDirectory, ...args], {
    cwd: repository, stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  const done = once(child, "close").then(([code]) => { children.delete(child); return code as number; });
  return { child, done, log: () => log };
}
async function until(check: () => Promise<boolean>, ms = 15_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await check().catch(() => false)) return;
    await delay(50);
  }
  throw new Error("Condition not reached");
}
async function alive(pid: number) {
  // An orphan can briefly be a zombie awaiting the container's init reaper.
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
  } catch { return false; }
}
afterEach(async () => {
  await Promise.all([...children].map(async (child) => {
    child.kill("SIGINT");
    await once(child, "close");
  }));
  children.clear();
});
describe.sequential("acceptance runner process isolation", () => {
  it("keeps the browser API working and kills real Chromium/server descendants at timeout", async () => {
    const success = launch("--file", "browser", "--step-timeout-ms", "15000");
    expect(await success.done, success.log()).toBe(0);
    expect((await snapshot()).summary.PASS).toBe(1);
    const pidsPath = path.join(repository, "dist/acceptance/browser-pids.json");
    await rm(pidsPath, { force: true });
    const run = launch("--file", "browser-orphan", "--step-timeout-ms", "15000");
    await until(async () => Boolean(await readFile(pidsPath, "utf8")));
    const members: { pid: number; command: string }[] = JSON.parse(await readFile(pidsPath, "utf8"));
    expect(members.some((member) => /headless_shell/.test(member.command))).toBe(true);
    expect(await run.done).toBe(1);
    await until(async () => (await Promise.all(members.map(({ pid }) => alive(pid)))).every((value) => !value));
  }, 60_000);

  it("runs selected successful module, records progress metadata and rejects unknown names", async () => {
    const run = launch("--file", "pass");
    expect(await run.done).toBe(0);
    const result = await snapshot();
    expect(result.complete).toBe(true);
    expect(result.running).toBeNull();
    expect(result.filter).toEqual(["pass"]);
    expect(result.runId).toMatch(/^\d+$/);
    expect(result.startedAt).toBeTruthy();
    expect(result.summary.PASS).toBe(2);
    expect(result.results.map((r: { id: string }) => r.id)).toEqual(["PASS-1", "PASS-2"]);
    expect(result.results[0].detail.notes).toContain("worker stdout: fixture non-JSON output");
    expect(run.log()).toContain("▶ PASS-1");
    expect(run.log()).toContain("✔ PASS PASS-2");
    const invalid = launch("--file", "absent");
    expect(await invalid.done).toBe(2);
    expect(invalid.log()).toContain("Available:");
  }, 30_000);

  it("times out, persists incomplete progress and continues in a fresh module", async () => {
    const run = launch("--file", "hang", "--file", "pass", "--step-timeout-ms", "2000");
    await until(async () => {
      const result = await snapshot();
      return result.running === "HANG-1" && result.complete === false;
    });
    // A completed module is persisted before the next module finishes.
    await until(async () => {
      const result = await snapshot();
      return !result.complete && result.results.some((r: { id: string }) => r.id === "HANG-2");
    });
    expect(await run.done).toBe(1);
    const result = await snapshot();
    expect(result.complete).toBe(true);
    expect(result.results.map((r: { status: string }) => r.status)).toEqual(["FAIL", "NOT RUN", "PASS", "PASS"]);
    expect(result.results[0].detail.notes.join(" ")).toContain("期限切れ");
    expect(result.results[0].durationMs).toBeGreaterThanOrEqual(1900);
    expect(result.results[1].detail.notes).toContain("前の手順の期限切れ");
  }, 30_000);

  it("kills the worker and SIGTERM-ignoring grandchild at timeout", async () => {
    const pidsPath = path.join(repository, "dist/acceptance/orphan-pids.json");
    await rm(pidsPath, { force: true });
    const run = launch("--file", "orphan", "--step-timeout-ms", "2000");
    await until(async () => Boolean(await readFile(pidsPath, "utf8")));
    const pids = JSON.parse(await readFile(pidsPath, "utf8"));
    expect(await alive(pids.grandchild)).toBe(true);
    expect(await run.done).toBe(1);
    await until(async () => !await alive(pids.worker) && !await alive(pids.grandchild));
    expect((await snapshot()).complete).toBe(true);
  }, 30_000);

  it.each(["SIGINT", "SIGTERM"] as const)("writes interruption and exits 130 on %s", async (signal) => {
    const pidsPath = path.join(repository, "dist/acceptance/orphan-pids.json");
    await rm(pidsPath, { force: true });
    const run = launch("--file", "orphan");
    await until(async () => Boolean(await readFile(pidsPath, "utf8")));
    const pids = JSON.parse(await readFile(pidsPath, "utf8"));
    await until(async () => (await snapshot()).running === "ORPHAN-1");
    run.child.kill(signal);
    expect(await run.done).toBe(130);
    const result = await snapshot();
    expect(result.complete).toBe(false);
    expect(result.interrupted).toBe(true);
    expect(result.running).toBeNull();
    await until(async () => !await alive(pids.worker) && !await alive(pids.grandchild));
  }, 30_000);
});
