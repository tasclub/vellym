import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";

const cli = path.resolve("packages/vellym/dist/cli.mjs");
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vellym-cli-add-"));
  await mkdir(path.join(root, "content"));
  await writeFile(path.join(root, "vellym.config.yaml"), stringify({ schemaVersion: "1.0", contentRoot: "content", outputDir: "dist", ui: { language: "en" }, plugins: [] }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const run = (...args: string[]) => spawnSync(process.execPath, [cli, "add", ...args], { cwd: root, encoding: "utf8" });

it("lists localized catalog and previews without writing", async () => {
  const list = run("--list", "template", "--json");
  expect(list.status).toBe(0);
  expect(JSON.parse(list.stdout).data.some((item: { id: string }) => item.id === "decision")).toBe(true);
  const preview = run("template", "decision", "--folder", "custom", "--dry-run", "--json");
  expect(preview.status).toBe(0);
  expect(JSON.parse(preview.stdout).data.plan.files.at(-1).status).toBe("create");
  expect(await readdir(path.join(root, "content"))).toEqual([]);
});

it("applies, reports skips and appends the guide only once", async () => {
  await writeFile(path.join(root, "VELLYM.md"), "original");
  expect(run("template", "decision", "--folder", "custom", "--guide").status).toBe(0);
  const again = run("template", "decision", "--folder", "custom", "--guide");
  expect(again.status).toBe(0);
  expect(again.stdout).toContain("skip:");
  const guide = await readFile(path.join(root, "VELLYM.md"), "utf8");
  expect(guide.startsWith("original")).toBe(true);
  expect(guide.match(/vellym:guide:/g)).toHaveLength(1);
});

it("reports invalid requests as usage errors and offers bilingual help", () => {
  expect(run("template", "missing").status).toBe(2);
  expect(run("template", "tickets:work").status).toBe(2);
  expect(run("--help", "--language", "en").stdout).toContain("preview");
  expect(run("--help", "--language", "ja").stdout).toContain("計画");
});

it("lists and applies templates from an enabled plugin", async () => {
  await mkdir(path.join(root, "node_modules", "@vellym"), { recursive: true });
  await symlink(path.resolve("packages/plugin-tickets"), path.join(root, "node_modules", "@vellym", "tickets"), "dir");
  await writeFile(path.join(root, "vellym.config.yaml"), stringify({ schemaVersion: "1.0", contentRoot: "content", outputDir: "dist", ui: { language: "en" }, plugins: ["@vellym/tickets"] }));
  expect(run("--list", "template").stdout).toContain("tickets:work");
  const result = run("template", "tickets:work", "--folder", "work");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("create:");
});
