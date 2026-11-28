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
    await write("canvas", "DesignCanvas", "move-canvas", { formatVersion: 1 });
    await write("+boards/board", "DesignBoard", "board", {
      canvas: "move-canvas", x: 40, y: 40,
      root: { id: "root", type: "frame", width: 600, height: 400, fills: [{ color: "#fff" }], children: [
        { id: "a", type: "rectangle", x: 20, y: 20, width: 100, height: 60, fills: [{ color: "#abc" }] },
        { id: "b", type: "rectangle", x: 300, y: 20, width: 80, height: 80, fills: [{ color: "#cba" }] },
        { id: "row", type: "frame", x: 20, y: 250, width: 300, height: 60, layout: { display: "flex", gap: 8 },
          fills: [{ color: "#eee" }], children: [
            { id: "flowing", type: "rectangle", width: 40, height: 40, fills: [{ color: "#9ab" }] }
          ] }
      ] }
    });
    await use(project);
  }
});
test.use({ plugins: ["design"] });

const boardFile = (content: string) => path.join(content, "design/+boards/board.yaml");
async function saved(content: string, id: string) {
  const root = parse(await readFile(boardFile(content), "utf8")).spec.root;
  const find = (node: { id: string; children?: unknown[] }): Record<string, unknown> | undefined =>
    node.id === id ? node as Record<string, unknown>
      : (node.children as { id: string }[] | undefined)?.map(find).find(Boolean);
  return find(root);
}
async function open(page: Page, server: string) {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /move-canvas/ }).click();
  await expect(page.getByTestId("design-node-a")).toBeVisible();
  // Work at 100% so screen pixels equal design pixels.
  await page.getByTestId("design-zoom-reset").click();
}
async function centre(page: Page, testId: string) {
  const box = (await page.getByTestId(testId).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, modifiers: ("Shift" | "Alt")[] = []) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}
const settle = (page: Page) => expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saved");

test("drag moves, one undo step, arrow nudges and flow children stay put @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  // Pressing an unselected node selects it and the same drag moves it.
  await drag(page, await centre(page, "design-node-a"), 60, 40);
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "80px");
  await settle(page);
  await expect.poll(() => saved(project.content, "a")).toMatchObject({ x: 80, y: 60 });
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "20px");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "80px");

  // Arrows: 1px, Shift 10px; quick repeats are one undo step.
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "83px");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("top", "70px");
  await settle(page);
  await expect.poll(() => saved(project.content, "a")).toMatchObject({ x: 83, y: 70 });
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "80px");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("top", "60px");

  // Several selected nodes move together.
  await page.keyboard.down("Shift");
  await page.mouse.click(...Object.values(await centre(page, "design-node-b")) as [number, number]);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("design-selection")).toHaveCount(2);
  await drag(page, await centre(page, "design-node-b"), -30, 50);
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "50px");
  await expect(page.getByTestId("design-node-b")).toHaveCSS("top", "70px");

  // A child placed by its parent's flex flow does not move (reordering is a later ticket).
  await page.keyboard.press("Escape");
  const flowing = await centre(page, "design-node-flowing");
  await page.keyboard.down("Control");
  await page.mouse.click(flowing.x, flowing.y);
  await page.keyboard.up("Control");
  await expect(page.getByTestId("design-selection")).toHaveAttribute("data-node", "board/flowing");
  const before = (await page.getByTestId("design-node-flowing").boundingBox())!;
  await drag(page, flowing, 80, 60);
  expect((await page.getByTestId("design-node-flowing").boundingBox())!.x).toBeCloseTo(before.x, 0);
  await page.keyboard.press("ArrowRight");
  expect((await page.getByTestId("design-node-flowing").boundingBox())!.x).toBeCloseTo(before.x, 0);
  await settle(page);
  expect(await saved(project.content, "flowing")).not.toHaveProperty("x");
});

test("handles resize with Shift and Alt, corners rotate with 15-degree Shift steps @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  await page.mouse.click(...Object.values(await centre(page, "design-node-a")) as [number, number]);
  await expect(page.getByTestId("design-handle-se")).toBeVisible();
  await drag(page, await centre(page, "design-handle-se"), 30, 20);
  await expect(page.getByTestId("design-node-a")).toHaveCSS("width", "130px");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("height", "80px");
  await settle(page);
  await expect.poll(() => saved(project.content, "a")).toMatchObject({ x: 20, y: 20, width: 130, height: 80 });

  // Shift keeps the ratio (130:80); Alt grows from the centre.
  await drag(page, await centre(page, "design-handle-e"), 26, 0, ["Shift"]);
  await expect(page.getByTestId("design-node-a")).toHaveCSS("width", "156px");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("height", "96px");
  await drag(page, await centre(page, "design-handle-w"), -10, 0, ["Alt"]);
  await expect(page.getByTestId("design-node-a")).toHaveCSS("width", "176px");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "10px");

  // Rotate from outside a corner; Shift lands on 15-degree steps. One drag is one undo step.
  const node = await centre(page, "design-node-a");
  const corner = (await page.getByTestId("design-rotate-ne").boundingBox())!;
  const start = { x: corner.x + corner.width * 0.75, y: corner.y + corner.height * 0.25 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(node.x + 200, node.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(page);
  const rotation = Number((await saved(project.content, "a"))?.rotation);
  expect(rotation % 15).toBe(0);
  expect(rotation).toBeGreaterThan(0);
  await expect(page.getByTestId("design-selection")).toHaveCSS("transform", /matrix/);
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect.poll(async () => (await saved(project.content, "a"))?.rotation).toBeUndefined();

  // The board itself resizes from its right and bottom edges only.
  const label = page.getByTestId("design-board-label-board");
  await label.click();
  await expect(page.getByTestId("design-handle-nw")).toHaveCount(0);
  await expect(page.getByTestId("design-rotate-ne")).toHaveCount(0);
  await drag(page, await centre(page, "design-handle-se"), 40, 30);
  await settle(page);
  await expect.poll(async () => parse(await readFile(boardFile(project.content), "utf8")).spec.root)
    .toMatchObject({ width: 640, height: 430 });
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});
