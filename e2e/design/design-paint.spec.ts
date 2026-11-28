import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect } from "../fixtures.js";
import type { Page } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DwHwyBDABb1Af5j3/oZAAAAABJRU5ErkJggg==", "base64");
const test = base.extend({
  project: async ({ project }, use) => {
    await mkdir(path.join(project.content, "design/+boards"), { recursive: true });
    const write = (file: string, kind: string, name: string, spec: unknown) =>
      writeFile(path.join(project.content, `design/${file}.yaml`), stringify({
        apiVersion: "vellym.tasclub.com/v1", kind, metadata: { name, title: name }, spec
      }));
    await write("canvas", "DesignCanvas", "paint-canvas", { formatVersion: 1, tokens: { files: ["base.tokens.json"] } });
    await writeFile(path.join(project.content, "design/base.tokens.json"), JSON.stringify({
      color: { brand: { $type: "color", $value: { colorSpace: "srgb", components: [0, 0.5, 0], hex: "#008000" } } },
      size: { line: { $type: "dimension", $value: { value: 3, unit: "px" } } }
    }));
    await write("+boards/board", "DesignBoard", "board", {
      canvas: "paint-canvas", x: 40, y: 40,
      root: { id: "root", type: "frame", width: 500, height: 300, fills: [{ color: "#ffffff" }], children: [
        { id: "a", type: "rectangle", x: 20, y: 20, width: 200, height: 100, fills: [{ color: "#d9d9d9" }] },
        { id: "b", type: "rectangle", x: 260, y: 20, width: 100, height: 100, fills: [{ color: "#123456" }] }
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
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /paint-canvas/ }).click();
  await expect(page.getByTestId("design-node-a")).toBeVisible();
  await page.getByTestId("design-zoom-reset").click();
}
async function select(page: Page, id: string, shift = false) {
  const box = (await page.getByTestId(`design-node-${id}`).boundingBox())!;
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (shift) await page.keyboard.up("Shift");
}
async function enter(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).press("Enter");
}

test("fills: colour, picker, tokens, list order and visibility, gradients with canvas handles, image @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  await select(page, "a");
  const rect = page.getByTestId("design-node-a");
  await enter(page, "design-fill-0-color", "#f00");
  await expect(rect).toHaveCSS("background-image", /rgb\(255, 0, 0\)/);
  await expect(page.getByTestId("design-fill-0-color")).toHaveValue("#ff0000");
  // The picker's hue and alpha sliders take the keyboard.
  await page.getByTestId("design-fill-0-color-swatch").click();
  const picker = page.getByTestId("design-fill-0-color-picker");
  await expect(picker.locator(".react-colorful")).toBeVisible();
  await picker.getByRole("slider", { name: /alpha/i }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("design-fill-0-color")).toHaveValue(/^#ff0000[0-9a-f]{2}$/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("design-fill-0-color-swatch")).toBeFocused();
  // A colour token from the button beside the field.
  await page.getByTestId("design-fill-0").getByTestId("design-token-button").click();
  await page.getByTestId("design-token-color.brand").click();
  await expect(page.getByTestId("design-fill-0-color")).toHaveValue("{color.brand}");
  await expect(rect).toHaveCSS("background-image", /0, 128, 0|0 0.5 0/);

  // A second fill goes on top; reorder, hide and remove.
  await page.getByTestId("design-fill-add").click();
  await enter(page, "design-fill-1-color", "#0000ff");
  await page.getByTestId("design-fill-1-down").click();
  await settle(page);
  await expect.poll(async () => (await node(project.content, "a")).fills).toEqual([{ color: "#0000ff" }, { color: "{color.brand}" }]);
  await page.getByTestId("design-fill-1-visible").uncheck();
  await enter(page, "design-fill-1-opacity", "40");
  await settle(page);
  await expect.poll(async () => (await node(project.content, "a")).fills).toEqual([{ color: "#0000ff" }, { color: "{color.brand}", visible: false, opacity: 0.4 }]);
  await page.getByTestId("design-fill-1-remove").click();

  // Linear gradient: angle, stops, a new stop, and dragging a stop on the canvas.
  await page.getByTestId("design-fill-0-kind").selectOption("linearGradient");
  await enter(page, "design-fill-0-angle", "90");
  await enter(page, "design-fill-0-stop-1-color", "#ffff00");
  await page.getByTestId("design-fill-0-stop-add").click();
  await expect(page.getByTestId("design-fill-0-stop-2")).toBeVisible();
  await expect(rect).toHaveCSS("background-image", /linear-gradient\(90deg/);
  await page.getByTestId("design-fill-0-handles").click();
  const stop = page.getByTestId("design-gradient-stop-0");
  await expect(stop).toBeVisible();
  const box = (await rect.boundingBox())!, handle = (await stop.boundingBox())!;
  // At 90° the axis runs left→right over the width: stop 0 starts at the left edge.
  expect(handle.x + handle.width / 2).toBeCloseTo(box.x, 0);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, handle.y + handle.height / 2, { steps: 4 });
  await page.mouse.up();
  await settle(page);
  await expect.poll(async () => ((await node(project.content, "a")).fills as { stops: { position: number }[] }[])[0]!.stops[0]!.position).toBe(0.25);
  expect(((await node(project.content, "a")).fills as Record<string, unknown>[])[0]).toMatchObject({ type: "linearGradient", angle: 90 });
  await page.getByTestId("design-fill-0-kind").selectOption("radialGradient");
  await expect(rect).toHaveCSS("background-image", /radial-gradient/);

  // An image fill from a file, then its fit.
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("design-fill-0-kind").selectOption("image");
  await (await chooser).setFiles({ name: "pixels.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("design-fill-0-fit")).toBeVisible();
  await page.getByTestId("design-fill-0-fit").selectOption("tile");
  await settle(page);
  await expect.poll(async () => ((await node(project.content, "a")).fills as Record<string, unknown>[])[0]).toMatchObject({ type: "image", fit: "tile" });
  await expect(rect).toHaveCSS("background-repeat", "repeat");

  // Different fills on two nodes read "mixed" until made the same.
  await select(page, "b", true);
  await expect(page.getByTestId("design-fill-unify")).toBeVisible();
  await page.getByTestId("design-fill-unify").click();
  await settle(page);
  await expect.poll(async () => (await node(project.content, "b")).fills).toEqual((await node(project.content, "a")).fills);
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});

test("strokes and effects: width with a token, position, dashes, caps and joins, shadows and blurs @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  await select(page, "a");
  await page.getByTestId("design-stroke-add").click();
  await enter(page, "design-field-stroke-width", "4");
  await page.getByTestId("design-field-stroke-align").selectOption("outside");
  await enter(page, "design-field-dash", "4 2");
  await page.getByTestId("design-field-stroke-cap").selectOption("round");
  await page.getByTestId("design-field-stroke-join").selectOption("bevel");
  await settle(page);
  await expect.poll(() => node(project.content, "a")).toMatchObject({
    strokes: [{ color: "#000000" }], strokeWidth: 4, strokeAlign: "outside", strokeDash: [4, 2], strokeCap: "round", strokeJoin: "bevel"
  });
  await expect(page.getByTestId("design-node-a").getByTestId("design-stroke-overlay")).toHaveCount(1);
  await page.getByTestId("design-field-stroke-width").locator("..").getByTestId("design-token-button").click();
  await page.getByTestId("design-token-size.line").click();
  await settle(page);
  await expect.poll(async () => (await node(project.content, "a")).strokeWidth).toBe("{size.line}");

  await page.getByTestId("design-shadow-add").click();
  await page.getByTestId("design-shadow-0-kind").selectOption("inner");
  await enter(page, "design-shadow-0-x", "2");
  await enter(page, "design-shadow-0-color", "#ff000080");
  await enter(page, "design-field-layer-blur", "3");
  await enter(page, "design-field-background-blur", "5");
  await settle(page);
  await expect.poll(() => node(project.content, "a")).toMatchObject({
    shadows: [{ x: 2, y: 4, blur: 8, spread: 0, color: "#ff000080", inset: true }], blur: 3, backgroundBlur: 5
  });
  await expect(page.getByTestId("design-node-a")).toHaveCSS("box-shadow", /inset/);
  await expect(page.getByTestId("design-node-a")).toHaveCSS("filter", "blur(3px)");
  await page.getByTestId("design-shadow-0-remove").click();
  await settle(page);
  await expect.poll(async () => (await node(project.content, "a")).shadows).toBeUndefined();
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});
