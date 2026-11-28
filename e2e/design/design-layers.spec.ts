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
    await write("canvas", "DesignCanvas", "layers-canvas", { formatVersion: 1 });
    await write("+boards/board", "DesignBoard", "board", {
      canvas: "layers-canvas", x: 40, y: 40,
      root: { id: "root", type: "frame", width: 500, height: 400, fills: [{ color: "#fff" }], children: [
        { id: "a", type: "rectangle", x: 10, y: 10, width: 60, height: 40, fills: [{ color: "#abc" }] },
        { id: "card", type: "frame", x: 100, y: 100, width: 200, height: 200, fills: [{ color: "#eee" }], children: [
          { id: "inner", type: "rectangle", x: 10, y: 10, width: 40, height: 40, fills: [{ color: "#cba" }] }
        ] },
        { id: "b", type: "rectangle", name: "Button", x: 350, y: 10, width: 60, height: 40, fills: [{ color: "#bcd" }] }
      ] }
    });
    await use(project);
  }
});
test.use({ plugins: ["design"] });

const boardFile = (content: string) => path.join(content, "design/+boards/board.yaml");
const saved = async (content: string) => parse(await readFile(boardFile(content), "utf8")).spec.root;
const ids = (node: { children?: { id: string }[] }) => node.children!.map(child => child.id);
const settle = (page: Page) => expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saved");
async function open(page: Page, server: string) {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /layers-canvas/ }).click();
  await expect(page.getByTestId("design-node-a")).toBeVisible();
}

test("the layer tree selects with the canvas, toggles, renames and reorders by keys and drags @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  const tree = page.getByRole("tree", { name: /レイヤー|Layers/ });
  await expect(tree).toBeVisible();
  // Top-most first, as drawn: b, card, a.
  await expect(tree.getByRole("treeitem")).toHaveText([/Board ?board/, /Button/, /card/, /Rectangle ?a/]);

  // Selection follows both ways; a nested selection opens its parent.
  await page.getByTestId("design-layer-b").click();
  await expect(page.getByTestId("design-selection")).toHaveAttribute("data-node", "board/b");
  const inner = (await page.getByTestId("design-node-inner").boundingBox())!;
  await page.keyboard.down("Control");
  await page.mouse.click(inner.x + inner.width / 2, inner.y + inner.height / 2);
  await page.keyboard.up("Control");
  await expect(page.getByTestId("design-layer-inner")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("design-layer-card")).toHaveAttribute("aria-expanded", "true");

  // Hide and lock from the row buttons.
  await page.getByTestId("design-layer-a-hide").click();
  await expect(page.getByTestId("design-node-a")).toHaveCSS("display", "none");
  await page.getByTestId("design-layer-b-lock").click();
  await settle(page);
  await expect.poll(async () => (await saved(project.content)).children.map((child: Record<string, unknown>) => [child.id, child.visible, child.locked]))
    .toEqual([["a", false, undefined], ["card", undefined, undefined], ["b", undefined, true]]);
  await page.getByTestId("design-layer-a-hide").click();
  await page.getByTestId("design-layer-b-lock").click();

  // Rename with a double-click, and with F2 from the keyboard.
  await page.getByTestId("design-layer-a").dblclick();
  await page.getByTestId("design-layer-rename").fill("Logo");
  await page.getByTestId("design-layer-rename").press("Enter");
  await expect(page.getByTestId("design-layer-a")).toContainText("Logo");
  await page.getByTestId("design-layer-card").focus();
  await page.keyboard.press("F2");
  await page.getByTestId("design-layer-rename").fill("Card");
  await page.getByTestId("design-layer-rename").press("Enter");
  await settle(page);
  await expect.poll(async () => (await saved(project.content)).children.map((child: Record<string, unknown>) => child.name))
    .toEqual(["Logo", "Card", "Button"]);

  // Keyboard: Alt+Up moves a layer toward the top; Alt+Left takes it out of its frame; Alt+Right puts it in.
  await page.getByTestId("design-layer-a").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await settle(page);
  await expect.poll(async () => ids(await saved(project.content))).toEqual(["card", "a", "b"]);
  await page.getByTestId("design-layer-inner").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await settle(page);
  await expect.poll(async () => ids(await saved(project.content))).toEqual(["card", "inner", "a", "b"]);
  // It stays where it was on the board: 100+10.
  await expect.poll(async () => (await saved(project.content)).children[1]).toMatchObject({ id: "inner", x: 110, y: 110 });
  await page.getByTestId("design-layer-inner").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await settle(page);
  await expect.poll(async () => ids((await saved(project.content)).children[0])).toEqual(["inner"]);
  // One step back with undo.
  await page.getByTestId("design-viewport").focus();
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect.poll(async () => ids(await saved(project.content))).toEqual(["card", "inner", "a", "b"]);

  // Arrow keys move the focus; Enter selects.
  await page.getByTestId("design-layer-b").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("design-layer-a")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("design-selection")).toHaveAttribute("data-node", "board/a");

  // Drag b into the card frame.
  await page.getByTestId("design-layer-b").dragTo(page.getByTestId("design-layer-card"), {
    targetPosition: { x: 60, y: 14 }
  });
  await settle(page);
  await expect.poll(async () => ids((await saved(project.content)).children[0])).toEqual(["b"]);
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});
