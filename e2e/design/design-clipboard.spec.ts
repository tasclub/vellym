import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect } from "../fixtures.js";
import type { Page } from "@playwright/test";

const test = base.extend({
  project: async ({ project }, use) => {
    await mkdir(path.join(project.content, "design/+boards"), { recursive: true });
    const write = (file: string, kind: string, name: string, spec: unknown) =>
      writeFile(path.join(project.content, `design/${file}.yaml`), stringify({
        apiVersion: "vellym.tasclub.com/v1", kind, metadata: { name, title: name }, spec
      }));
    await write("canvas", "DesignCanvas", "clip-canvas", { formatVersion: 1 });
    const board = (name: string, x: number, children: unknown[]) => write(`+boards/${name}`, "DesignBoard", name, {
      canvas: "clip-canvas", x, y: 40, root: { id: "root", type: "frame", width: 400, height: 300, fills: [{ color: "#fff" }], children }
    });
    await board("one", 40, [
      { id: "a", type: "rectangle", x: 10, y: 10, width: 40, height: 40, fills: [{ color: "#abc" }] },
      { id: "b", type: "rectangle", x: 100, y: 60, width: 60, height: 20, fills: [{ color: "#cba" }] },
      { id: "c", type: "rectangle", x: 300, y: 30, width: 20, height: 50, fills: [{ color: "#bcd" }] },
      { id: "chip", type: "instance", component: "chip", x: 10, y: 200 }
    ]);
    await board("two", 500, []);
    await use(project);
  }
});
test.use({ plugins: ["design"] });

const file = (content: string, name: string) => path.join(content, `design/+boards/${name}.yaml`);
const root = async (content: string, name = "one") => parse(await readFile(file(content, name), "utf8")).spec.root;
const children = async (content: string, name = "one") => (await root(content, name)).children as Record<string, unknown>[];
const settle = (page: Page) => expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saved");
async function open(page: Page, server: string) {
  await page.setViewportSize({ width: 1700, height: 1100 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /clip-canvas/ }).click();
  await expect(page.getByTestId("design-node-a")).toBeVisible();
  await page.getByTestId("design-zoom-reset").click();
}
async function select(page: Page, ...ids: string[]) {
  await page.keyboard.press("Escape");
  for (const [i, id] of ids.entries()) {
    const box = (await page.getByTestId(`design-node-${id}`).boundingBox())!;
    if (i) await page.keyboard.down("Shift");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (i) await page.keyboard.up("Shift");
  }
}
/** Fire the browser's copy/cut/paste on the canvas the way the shortcut does, with a real DataTransfer. */
async function clip(page: Page, type: "copy" | "cut" | "paste", text?: string) {
  return page.getByTestId("design-viewport").evaluate((element, [kind, data]) => {
    const transfer = new DataTransfer();
    if (data !== undefined) transfer.setData("text/plain", data);
    element.dispatchEvent(new ClipboardEvent(kind!, { clipboardData: transfer, bubbles: true, cancelable: true }));
    return transfer.getData("text/plain");
  }, [type, text] as const);
}

test("duplicate, Alt+drag, copy and paste across boards, cut and delete @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  // Ctrl+D: a copy 10px down-right, above the original, selected.
  await select(page, "a");
  await page.keyboard.press("Control+d");
  await expect(page.getByTestId("design-selection")).toHaveAttribute("data-node", "one/a-2");
  await settle(page);
  await expect.poll(async () => (await children(project.content)).map(child => child.id)).toEqual(["a", "a-2", "b", "c", "chip"]);
  expect((await children(project.content))[1]).toMatchObject({ x: 20, y: 20 });
  // One undo removes it again.
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect.poll(async () => (await children(project.content)).length).toBe(4);

  // Alt+drag leaves the original and moves a copy, as one undo step.
  const b = (await page.getByTestId("design-node-b").boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  await page.keyboard.down("Alt");
  await page.mouse.move(b.x + 40, b.y + 60, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await settle(page);
  await expect.poll(async () => (await children(project.content)).find(child => child.id === "b-2")).toMatchObject({ x: 130, y: 110 });
  expect((await children(project.content)).find(child => child.id === "b")).toMatchObject({ x: 100, y: 60 });
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect.poll(async () => (await children(project.content)).some(child => child.id === "b-2")).toBe(false);

  // Copy as text the system clipboard can hold, paste into the other board; instances stay instances.
  await select(page, "c", "chip");
  const text = await clip(page, "copy");
  expect(JSON.parse(text)).toMatchObject({ "vellym-design-nodes": 1, board: "one" });
  await page.getByTestId("design-board-label-two").click();
  await clip(page, "paste", text);
  await settle(page);
  await expect.poll(async () => (await children(project.content, "two")).map(child => [child.id, child.type, child.component]))
    .toEqual([["c-2", "rectangle", undefined], ["chip-2", "instance", "chip"]]);
  // No component file was made by the paste.
  expect((await readFile(file(project.content, "two"), "utf8"))).not.toContain("DesignComponent");

  // With nothing readable on the system clipboard, the screen's own copy pastes (into the same board, offset).
  await select(page, "a");
  await clip(page, "copy");
  await clip(page, "paste");
  await settle(page);
  await expect.poll(async () => (await children(project.content)).find(child => child.id === "a-2")).toMatchObject({ x: 20, y: 20 });

  // Cut takes it out; Delete removes the selection; neither touches the board.
  await select(page, "a-2");
  await clip(page, "cut");
  await settle(page);
  await expect.poll(async () => (await children(project.content)).some(child => child.id === "a-2")).toBe(false);
  await select(page, "b");
  await page.keyboard.press("Delete");
  await settle(page);
  await expect.poll(async () => (await children(project.content)).map(child => child.id)).toEqual(["a", "c", "chip"]);
});

test("align to the selection or the parent, and distribute evenly @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  await select(page, "a", "b", "c");
  const panel = page.getByTestId("design-inspector");
  await expect(panel.getByRole("heading", { name: /整列|Align/ })).toBeVisible();
  await page.getByTestId("design-align-top").click();
  await settle(page);
  await expect.poll(async () => (await children(project.content)).slice(0, 3).map(child => child.y)).toEqual([10, 10, 10]);
  // a 10..50 and c 300..320 hold 120 of width across 310: two gaps of 95 put b at 145.
  await page.getByTestId("design-distribute-x").click();
  await settle(page);
  await expect.poll(async () => (await children(project.content))[1]!.x).toBe(145);
  await page.getByTestId("design-align-centerY").click();
  await settle(page);
  await expect.poll(async () => (await children(project.content)).slice(0, 3).map(child => child.y)).toEqual([15, 25, 10]);
  // One node aligns within its parent (the board): right edge at 400.
  await select(page, "b");
  await expect(page.getByTestId("design-distribute-x")).toBeDisabled();
  await page.getByTestId("design-align-right").click();
  await settle(page);
  await expect.poll(async () => (await children(project.content))[1]!.x).toBe(340);
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});
