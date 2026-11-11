// @vitest-environment jsdom
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { PluginListView, type PluginViewPayload } from "../packages/ui-react/src/plugin/plugin-list-view.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let directory: string;
let payload: PluginViewPayload;
let root: Root | undefined;
let container: HTMLDivElement;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "vellym-list-summary-"));
  await mkdir(path.join(directory, "content/+tickets"), { recursive: true });
  await mkdir(path.join(directory, "node_modules/@vellym"), { recursive: true });
  for (const name of ["tickets", "plugin-api"]) {
    await symlink(path.resolve(`packages/${name === "tickets" ? "plugin-tickets" : name}`),
      path.join(directory, "node_modules/@vellym", name), "dir");
  }
  const config = path.join(directory, "vellym.config.yaml");
  await writeFile(config, `schemaVersion: "1.0"
contentRoot: content
outputDir: output
ui: { language: ja }
plugins: ["@vellym/tickets"]
`);
  await writeFile(path.join(directory, "content/tracker.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: summary-tracker, title: Summary fixture }
spec:
  statuses:
    - { id: todo, label: Todo, category: open }
    - { id: done, label: Done, category: closed }
  fields:
    - { id: estimate, label: "Estimate(h)", type: number }
    - { id: owner, label: Owner, type: text, listColumn: true }
  summary:
    - { field: estimate, method: sum }
`);
  await Promise.all(Array.from({ length: 106 }, (_, index) => writeFile(
    path.join(directory, `content/+tickets/task-${index}.yaml`),
    `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata: { name: task-${index}, title: Task ${index} }
spec:
  status: ${index === 105 ? "done" : "todo"}
  fields: { estimate: ${index === 105 ? 50 : 1}, owner: ${index < 2 ? "keep" : "other"} }
  blocks: []
`)));
  // Use the real CLI output, not a manually constructed descriptor or row set.
  const build = spawnSync(process.execPath, [path.resolve("packages/vellym/dist/cli.mjs"),
    "build", "--config", config, "--json"], { encoding: "utf8" });
  expect(build.status, build.stderr || build.stdout).toBe(0);
  const output = JSON.parse(build.stdout).data.outputDir as string;
  const manifest = JSON.parse(await readFile(path.join(output, "vellym-build.json"), "utf8"));
  const baked = path.join(output, "data", manifest.buildId, manifest.defaultLocale.toLowerCase(),
    "views/summary-tracker.json");
  payload = JSON.parse(await readFile(baked, "utf8")).data;
}, 30_000);

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container?.remove();
  window.localStorage.clear();
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

it.each([
  ["ja", "Estimate(h) 合計: 105", "Estimate(h) 合計: 2", "Estimate(h) 合計: —"],
  ["en", "Estimate(h) Sum: 105", "Estimate(h) Sum: 2", "Estimate(h) Sum: —"]
])("renders static build summaries from every filtered row (%s)", (locale, initial, filtered, empty) => {
  expect(payload.rows).toHaveLength(105);
  expect(payload.allRows).toHaveLength(106);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(PluginListView, {
    payload, projectRoot: directory, targetName: "summary-tracker", locale
  })));
  const summary = container.querySelector("section[aria-live]")!;
  expect(summary.textContent).toBe(initial);
  const search = container.querySelector<HTMLInputElement>('input[id="plugin-filter-field:owner"]')!;
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  const searchFor = (value: string) => act(() => {
    setValue.call(search, value);
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  searchFor("keep");
  expect(summary.textContent).toBe(filtered);
  searchFor("no-match");
  expect(summary.textContent).toBe(empty);
  searchFor("");
  expect(summary.textContent).toBe(initial);
});
