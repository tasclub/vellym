import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect } from "../fixtures.js";
import type { Page } from "@playwright/test";

// A 2×1 PNG: red and blue pixels.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DwHwyBDABb1Af5j3/oZAAAAABJRU5ErkJggg==", "base64");

const test = base.extend({
  project: async ({ project }, use) => {
    await mkdir(path.join(project.content, "design"), { recursive: true });
    await writeFile(path.join(project.content, "design/blank.yaml"), stringify({
      apiVersion: "vellym.tasclub.com/v1", kind: "DesignCanvas", metadata: { name: "blank", title: "Blank" }, spec: { formatVersion: 1 }
    }));
    await use(project);
  }
});
test.use({ plugins: ["design"] });

const boardsDir = (content: string) => path.join(content, "design/+boards");
async function boards(content: string) {
  const files = (await readdir(boardsDir(content)).catch(() => [] as string[])).filter(file => file.endsWith(".yaml"));
  return Promise.all(files.map(async file => ({ file, ...parse(await readFile(path.join(boardsDir(content), file), "utf8")) })));
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifier?: "Shift") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

test("from a blank canvas: a board, every shape, an image, saved YAML and deleting the board @DESIGN-A01", async ({ page, server, project }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /Blank/ }).click();
  await expect(page.getByTestId("design-empty")).toBeVisible();
  await page.getByTestId("design-zoom-reset").click();
  const viewport = (await page.getByTestId("design-viewport").boundingBox())!;
  const at = (x: number, y: number) => ({ x: viewport.x + x, y: viewport.y + y });

  // A shape on empty canvas explains itself; a frame there becomes a new board.
  await page.getByTestId("design-viewport").focus();
  await page.keyboard.press("r");
  await expect(page.getByTestId("design-tool-rectangle")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(at(100, 100).x, at(100, 100).y);
  await expect(page.getByRole("status").filter({ hasText: /board|ボード/ }).first()).toBeVisible();
  await expect(page.getByTestId("design-tool-select")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("design-tool-frame").click();
  await drag(page, at(60, 80), at(560, 480));
  await expect.poll(async () => (await boards(project.content)).length).toBe(1);
  const [board] = await boards(project.content);
  expect(board!.spec.root).toMatchObject({ type: "frame", width: 500, height: 400 });
  const name = board!.metadata.name as string;
  const host = page.getByTestId(`design-board-${name}`);
  await expect(host).toBeVisible();
  const origin = (await host.boundingBox())!;
  const inBoard = (x: number, y: number) => ({ x: origin.x + x, y: origin.y + y });

  // Each tool draws inside the board and hands back to the select tool.
  await page.keyboard.press("r");
  await drag(page, inBoard(20, 20), inBoard(120, 80));
  await expect(page.getByTestId("design-tool-select")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("design-selection")).toHaveAttribute("data-node", `${name}/rectangle-1`);
  await page.keyboard.press("o");
  await drag(page, inBoard(150, 20), inBoard(190, 40), "Shift");
  await page.keyboard.press("l");
  await drag(page, inBoard(220, 30), inBoard(300, 30));
  await page.getByTestId("design-tool-more").selectOption("polygon");
  await page.mouse.click(inBoard(20, 150).x, inBoard(20, 150).y);
  await page.getByTestId("design-tool-more").selectOption("star");
  await page.mouse.click(inBoard(150, 150).x, inBoard(150, 150).y);
  await page.keyboard.press("f");
  await drag(page, inBoard(300, 150), inBoard(460, 300));
  // A rectangle drawn on the inner frame goes into it.
  await page.keyboard.press("r");
  await drag(page, inBoard(320, 170), inBoard(360, 200));

  // An image from the file picker lands in the selected frame's board.
  await page.getByTestId("design-image-input").setInputFiles({ name: "pixels.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("design-node-image-1")).toBeVisible();

  await expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saved");
  await expect.poll(async () => ((await boards(project.content))[0]!.spec.root.children as { id: string }[]).map(child => child.id))
    .toEqual(["rectangle-1", "ellipse-1", "line-1", "polygon-1", "star-1", "frame-1", "image-1"]);
  const children = (await boards(project.content))[0]!.spec.root.children as Record<string, unknown>[];
  const byId = Object.fromEntries(children.map(child => [child.id, child]));
  expect(byId["rectangle-1"]).toMatchObject({ type: "rectangle", x: 20, y: 20, width: 100, height: 60 });
  expect(byId["ellipse-1"]).toMatchObject({ type: "ellipse", width: 40, height: 40 });
  expect(byId["line-1"]).toMatchObject({ type: "line", width: 80, height: 0 });
  expect(byId["polygon-1"]).toMatchObject({ type: "polygon", x: 20, y: 150, width: 100, height: 100, pointCount: 3 });
  expect(byId["star-1"]).toMatchObject({ type: "star", pointCount: 5 });
  expect(byId["frame-1"]).toMatchObject({ type: "frame", x: 300, y: 150, width: 160, height: 150,
    children: [{ type: "rectangle", x: 20, y: 20, width: 40, height: 30 }] });
  expect(byId["image-1"]).toMatchObject({ type: "image", width: 2, height: 1, alt: "pixels.png" });
  const asset = byId["image-1"]!.asset as string;
  expect((await page.request.get(`${server}/api/v1/assets?path=${encodeURIComponent(asset)}`)).status()).toBe(200);
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);

  // Deleting the board asks first; cancelling keeps it.
  await page.getByTestId(`design-board-label-${name}`).click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("design-confirm-delete")).toContainText(/Board 1|ボード 1/);
  await expect(page.getByTestId("design-confirm-cancel")).toBeFocused();
  await page.getByTestId("design-confirm-cancel").click();
  expect(await boards(project.content)).toHaveLength(1);
  await page.keyboard.press("Delete");
  await page.getByTestId("design-confirm-ok").click();
  await expect.poll(async () => (await boards(project.content)).length).toBe(0);
  await expect(page.getByTestId("design-empty")).toBeVisible();
});
