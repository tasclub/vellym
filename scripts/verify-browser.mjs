import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";

// Each browser test creates its own fixture under os.tmpdir() and cleans it up.
const tests = (await readdir("tests")).filter((name) => name.endsWith(".browser.mjs")).sort();
if (tests.length === 0) throw new Error("No browser tests found");
let failed = false;
for (const test of tests) {
  console.log(`\nRunning tests/${test}`);
  const result = spawnSync(process.execPath, [`tests/${test}`], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error(`Failed: ${test}`, result.error ?? `exit ${result.status ?? result.signal}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
