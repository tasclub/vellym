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
    await write("canvas", "DesignCanvas", "snap-canvas", { formatVersion: 1 });
    const rect = (id: string, x: number, y: number, width: number, height: number) =>
      ({ id, type: "rectangle", x, y, width, height, fills: [{ color: "#9ab" }] });
    await write("+boards/board", "DesignBoard", "board", {
      canvas: "snap-canvas", x: 40, y: 40,
      root: { id: "root", type: "frame", width: 600, height: 400, fills: [{ color: "#fff" }], children: [
        rect("a", 20, 20, 100, 60), rect("b", 300, 20, 80, 80),
        rect("left", 20, 250, 50, 50), rect("mid", 150, 250, 60, 50), rect("right", 400, 250, 50, 50)
      ] }
    });
    await use(project);
  }
});
test.use({ plugins: ["design"] });

const boardFile = (content: string) => path.join(content, "design/+boards/board.yaml");
const node = async (content: string, id: string) =>
  (parse(await readFile(boardFile(content), "utf8")).spec.root.children as Record<string, unknown>[]).find(child => child.id === id)!;
const settle = (page: Page) => expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saved");
async function open(page: Page, server: string) {
  await page.setViewportSize({ width: 1700, height: 1100 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /snap-canvas/ }).click();
  await expect(page.getByTestId("design-node-a")).toBeVisible();
  await page.getByTestId("design-zoom-reset").click();
}
async function centre(page: Page, id: string) {
  const box = (await page.getByTestId(`design-node-${id}`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
/** Drag by (dx, dy), checking what shows just before release. */
async function drag(page: Page, id: string, dx: number, dy: number, during?: () => Promise<void>, modifier?: "Control") {
  const from = await centre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  if (during) await during();
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

test("moves snap to edges and equal gaps with guides; Ctrl turns snapping off @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  // a's left edge lands 3px short of b's left edge (below b, so they do not overlap): it snaps to 300.
  await drag(page, "a", 277, 120, async () => {
    await expect(page.getByTestId("design-guide").first()).toBeVisible();
  });
  await expect(page.getByTestId("design-guide")).toHaveCount(0);
  await settle(page);
  await expect.poll(() => node(project.content, "a")).toMatchObject({ x: 300, y: 140 });
  // With Ctrl held, the same kind of near miss stays where it was dropped (out 10px and back 7px).
  const from = await centre(page, "a");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down("Control");
  await page.mouse.move(from.x + 10, from.y, { steps: 4 });
  await page.mouse.move(from.x + 3, from.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await settle(page);
  await expect.poll(async () => (await node(project.content, "a")).x).toBe(303);

  // mid between left (ends 70) and right (starts 400): equal gaps of 135 put it at 205.
  await drag(page, "mid", 53, 0, async () => {
    await expect(page.getByTestId("design-gap")).toHaveCount(2);
    await expect(page.getByTestId("design-gap").first()).toContainText("135");
  });
  await settle(page);
  await expect.poll(async () => (await node(project.content, "mid")).x).toBe(205);
});

test("Alt shows distances, Shift+R toggles rulers, layout grids show, save and snap @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  // Select a, then hold Alt over b: the gap between them (300 - 120 = 180).
  const a = await centre(page, "a");
  await page.mouse.click(a.x, a.y);
  const b = await centre(page, "b");
  await page.keyboard.down("Alt");
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await expect(page.getByTestId("design-distance")).toContainText("180");
  await page.keyboard.up("Alt");
  await expect(page.getByTestId("design-distance")).toHaveCount(0);

  await page.getByTestId("design-viewport").focus();
  await page.keyboard.press("Shift+R");
  await expect(page.getByTestId("design-ruler-x")).toBeVisible();
  await expect(page.getByTestId("design-ruler-x").locator("text").first()).toBeVisible();
  await expect(page.getByTestId("design-rulers-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+R");
  await expect(page.getByTestId("design-rulers")).toHaveCount(0);

  // Columns on the board: shown on the canvas, saved, and moves snap to their edges.
  await page.getByTestId("design-board-label-board").click();
  await page.getByTestId("design-grid-add").click();
  await expect(page.getByTestId("design-layout-grid")).toHaveCount(4);
  await page.getByTestId("design-grid-0-count").fill("2");
  await page.getByTestId("design-grid-0-count").press("Enter");
  await expect(page.getByTestId("design-layout-grid")).toHaveCount(2);
  await settle(page);
  await expect.poll(async () => parse(await readFile(boardFile(project.content), "utf8")).spec.root.layoutGrids)
    .toEqual([{ pattern: "columns", count: 2, gutter: 16, margin: 16, alignment: "stretch" }]);
  // Columns at 16..292 and 308..584: a's left edge dropped at 17 snaps to the column edge at 16.
  await page.keyboard.press("Escape");
  await drag(page, "a", -3, 100);
  await settle(page);
  await expect.poll(async () => (await node(project.content, "a")).x).toBe(16);
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});
