import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { startDevServer } from "../packages/runtime-node/src/server.js";

let root: string;
const cli = path.resolve("packages/vellym/dist/cli.mjs");
const plugin = path.resolve("packages/plugin-tickets");
const hostVersion = JSON.parse(await readFile("packages/vellym/package.json", "utf8")).version;
async function install() {
  await mkdir(path.join(root, "node_modules/@vellym"), { recursive: true });
  await symlink(plugin, path.join(root, "node_modules/@vellym/tickets"));
}
function run(...args: string[]) {
  return execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "guide-wire-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("includes installed guides during init", async () => {
  await install();
  run("init", ".", "--plugins", "tickets", "--language", "en");
  expect(await readFile(path.join(root, "docs/VELLYM.md"), "utf8")).toContain("<!-- vellym:guide:tickets -->");
});

it("reports missing plugins and adds the guide once after installation", async () => {
  expect(run("init", ".", "--plugins", "tickets", "--language", "en")).toContain("vellym add guide");
  const guide = path.join(root, "docs/VELLYM.md");
  expect(await readFile(guide, "utf8")).not.toContain("<!-- vellym:guide:tickets -->");
  await install();
  const config = path.join(root, "docs/vellym.config.yaml");
  expect(JSON.parse(run("add", "guide", "--config", config, "--json")).data.added).toContain("tickets");
  expect(JSON.parse(run("add", "guide", "--config", config, "--json")).data.existing).toContain("tickets");
  expect((await readFile(guide, "utf8")).match(/<!-- vellym:guide:tickets -->/g)).toHaveLength(1);
});

it("ignores client sections in setup plan and apply", async () => {
  await install();
  const ui = path.join(root, "ui");
  await mkdir(ui);
  await writeFile(path.join(ui, "index.html"), "UI");
  const server = await startDevServer({ configPath: path.join(root, "vellym.config.yaml"), uiRoot: ui, hostVersion, port: 0 });
  try {
    const post = (endpoint: string, body: unknown) => fetch(`${server.url}/api/v1/setup/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const input = { root: "docs", structure: "by-type", numbered: false, language: "en", plugins: ["@vellym/tickets"], guideSections: [{ id: "evil", title: "evil", body: "evil" }] };
    const response = await post("plan", input);
    expect(response.status).toBe(200);
    const plan = (await response.json()).data;
    expect(plan.request.guideSections.map((s: { id: string }) => s.id)).toEqual(["tickets"]);
    plan.request.guideSections = input.guideSections;
    expect((await post("apply", plan)).status).toBe(200);
    const guide = await readFile(path.join(root, "docs/VELLYM.md"), "utf8");
    expect(guide).toContain("<!-- vellym:guide:tickets -->");
    expect(guide).not.toContain("<!-- vellym:guide:evil -->");
  } finally { await server.close(); }
});
