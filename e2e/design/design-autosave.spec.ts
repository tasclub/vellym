import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import type { Page } from "@playwright/test";
import { test as base, expect } from "../fixtures.js";
import type { DesignNode } from "../../packages/plugin-design/src/model/types.js";
import type { DesignOperation } from "../../packages/plugin-design/src/edit/operations.js";

const root = (x: number): DesignNode => ({ id: "root", type: "frame", width: 300, height: 200,
  fills: [{ color: "#ffffff" }], children: [
    { id: "rect", type: "rectangle", x, y: 20, width: 40, height: 40, fills: [{ color: "#2563eb" }] }
  ] });
const boardFile = (content: string, name = "board") => path.join(content, `design/+boards/${name}.yaml`);
async function writeX(file: string, x: number) {
  const document = parse(await readFile(file, "utf8"));
  document.spec.root.children[0].x = x;
  await writeFile(file, stringify(document));
}
async function readX(file: string) { return parse(await readFile(file, "utf8")).spec.root.children[0].x; }
async function apply(page: Page, before: number, after: number, second = false) {
  const operation: DesignOperation = { changes: [{ targetName: "board", before: root(before), after: root(after) }] };
  if (second) operation.changes.push({ targetName: "second", before: root(before), after: root(after) });
  expect(await page.evaluate(op => window.__vellymDesign!.apply(op), operation)).toBe(true);
}
async function open(page: Page, server: string) {
  await page.addInitScript(() => { window.__vellymDesignTest = true; });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /Autosave canvas/ }).click();
  await expect(page.getByTestId("design-board-board").getByTestId("design-node-rect")).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__vellymDesign)).toBe(true);
}
const test = base.extend<{ expectedConsoleErrors: RegExp[] }>({
  expectedConsoleErrors: [[], { option: true }],
  // Negative save tests intentionally provoke HTTP/network errors. Keep all other
  // console/page errors fatal, and require each explicitly expected error to occur.
  page: async ({ context, resources, expectedConsoleErrors }, use) => {
    const page = await context.newPage();
    const errors: string[] = [];
    const seen: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() !== "error") return;
      const text = `${message.text()} (${message.location().url})`;
      if (expectedConsoleErrors.some(pattern => pattern.test(text))) seen.push(text);
      else errors.push(text);
    });
    try { await use(page); }
    finally {
      await page.close();
      expect(errors, "Unexpected browser errors").toEqual([]);
      for (const pattern of expectedConsoleErrors) expect(seen.filter(text => pattern.test(text))).toHaveLength(1);
    }
  },
  project: async ({ project }, use) => {
    await mkdir(path.join(project.content, "design/+boards"), { recursive: true });
    const document = (kind: string, name: string, spec: unknown) => stringify({
      apiVersion: "vellym.tasclub.com/v1", kind, metadata: { name, title: name === "canvas" ? "Autosave canvas" : name }, spec
    });
    await writeFile(path.join(project.content, "design/canvas.yaml"),
      document("DesignCanvas", "canvas", { formatVersion: 1 }));
    for (const name of ["board", "second"]) await writeFile(boardFile(project.content, name),
      document("DesignBoard", name, { canvas: "canvas", x: name === "board" ? 0 : 400, y: 0, root: root(10) }));
    await use(project);
  }
});
test.use({ plugins: ["design"] });

test("autosaves the root and supports undo/redo after self notifications @DESIGN-D01", async ({ page, server, project }, info) => {
  await open(page, server);
  const writes: unknown[] = [];
  page.on("request", request => {
    if (request.method() === "PATCH" && request.url().endsWith("/api/v1/pages/board")) writes.push(request.postDataJSON());
  });
  let release!: () => void;
  const saving = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/pages/board", async route => {
    if (route.request().method() === "PATCH") await saving;
    await route.continue();
  });
  await apply(page, 10, 30);
  await expect(page.getByTestId("design-board-board").getByTestId("design-node-rect")).toHaveCSS("left", "30px");
  try { await expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saving"); }
  finally { release(); }
  await expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saved");
  await expect.poll(() => readX(boardFile(project.content))).toBe(30);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ baseHash: expect.any(String), specValues: [{ path: ["root"], value: root(30) }] });
  await page.getByTestId("design-viewport").focus();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("design-board-board").getByTestId("design-node-rect")).toHaveCSS("left", "10px");
  await expect.poll(() => readX(boardFile(project.content))).toBe(10);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => readX(boardFile(project.content))).toBe(30);
  expect(writes[1]).not.toMatchObject({ baseHash: (writes[0] as { baseHash: string }).baseHash });
  await expect(page.getByTestId("design-reloaded")).toHaveCount(0);
  const statusBox = await page.getByTestId("design-save-status").boundingBox();
  expect(statusBox?.width).toBeGreaterThan(10);
  await page.screenshot({ path: info.outputPath("saved.png") });
  await page.reload();
  await expect(page.getByTestId("design-board-board").getByTestId("design-node-rect")).toHaveCSS("left", "30px");
});

test("external YAML changes discard pending edits/history without overwriting the file @DESIGN-D01", async ({ page, server, project }) => {
  await open(page, server);
  await apply(page, 10, 20);
  const file = boardFile(project.content);
  await writeX(file, 90);
  await expect(page.getByTestId("design-reloaded")).toBeVisible();
  await expect(page.getByTestId("design-board-board").getByTestId("design-node-rect")).toHaveCSS("left", "90px");
  await page.getByTestId("design-viewport").focus();
  await page.keyboard.press("Meta+z");
  // Wait beyond the debounce through an assertion that also proves a fresh operation saves correctly.
  await apply(page, 90, 91);
  await expect.poll(() => readX(file)).toBe(91);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => readX(file)).toBe(90);
  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("design-board-board").getByTestId("design-node-rect")).toHaveCSS("left", "90px");
});

test.describe("conflict response", () => {
test.use({ expectedConsoleErrors: [/^Failed to load resource: the server responded with a status of 409 \(Conflict\) \(http:\/\/127\.0\.0\.1:\d+\/api\/v1\/pages\/second\)$/] });
test("a real 409 midway through a multi-file save reloads every root @DESIGN-D01", async ({ page, server, project }) => {
  await open(page, server);
  const second = boardFile(project.content, "second");
  let conflicts = 0;
  page.on("response", response => { if (response.status() === 409) conflicts++; });
  await page.route("**/api/v1/pages/second", async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    // The model and baseHash are already captured. Change the file before the actual PATCH.
    await writeX(second, 90);
    await route.continue();
  });
  await apply(page, 10, 30, true);
  await expect(page.getByTestId("design-reloaded")).toBeVisible();
  expect(conflicts).toBe(1);
  expect(await readX(boardFile(project.content))).toBe(30);
  expect(await readX(second)).toBe(90);
  await expect(page.getByTestId("design-board-board").getByTestId("design-node-rect")).toHaveCSS("left", "30px");
  await expect(page.getByTestId("design-board-second").getByTestId("design-node-rect")).toHaveCSS("left", "90px");
  await page.getByTestId("design-viewport").focus();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("design-board-board").getByTestId("design-node-rect")).toHaveCSS("left", "30px");
  await expect(page.getByTestId("design-board-second").getByTestId("design-node-rect")).toHaveCSS("left", "90px");
});
});

test.describe("network failure", () => {
test.use({ expectedConsoleErrors: [/^Failed to load resource: net::ERR_FAILED \(http:\/\/127\.0\.0\.1:\d+\/api\/v1\/pages\/board\)$/] });
test("saving failures are visible without discarding the model @DESIGN-D01", async ({ page, server }) => {
  await open(page, server);
  await page.route("**/api/v1/pages/board", async route => {
    if (route.request().method() === "PATCH") await route.abort("failed");
    else await route.continue();
  });
  await apply(page, 10, 30);
  await expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saveFailed");
  await expect(page.getByTestId("design-board-board").getByTestId("design-node-rect")).toHaveCSS("left", "30px");
});
});
