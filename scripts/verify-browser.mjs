import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";

// Each browser test creates its own fixture under os.tmpdir() and cleans it up.
const tests = (await readdir("tests")).filter((name) => name.endsWith(".browser.mjs")).sort();
if (tests.length === 0) throw new Error("No browser tests found");
let failed = false;
const limitMs = 5 * 60 * 1000;
const run = (test) => spawnSync(process.execPath, [`tests/${test}`], { stdio: "inherit", timeout: limitMs, killSignal: "SIGKILL" });
for (const test of tests) {
  console.log(`\nRunning tests/${test}`);
  // A browser test that hangs (e.g. a child process that never exits) must fail fast with its
  // name instead of using up the CI job timeout.
  const result = run(test);
  if (result.signal === "SIGKILL") console.error(`Timed out after ${limitMs / 1000}s: ${test}`);
  if (result.error || result.status !== 0) {
    console.error(`Failed: ${test}`, result.error ?? `exit ${result.status ?? result.signal}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
