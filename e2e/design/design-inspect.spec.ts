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
    await write("canvas", "DesignCanvas", "inspect-canvas", { formatVersion: 1, tokens: { files: ["base.tokens.json"] } });
    await writeFile(path.join(project.content, "design/base.tokens.json"), JSON.stringify({
      radius: { m: { $type: "dimension", $value: { value: 12, unit: "px" } } }
    }));
    await write("+boards/board", "DesignBoard", "board", {
      canvas: "inspect-canvas", x: 40, y: 40,
      root: { id: "root", type: "frame", width: 500, height: 300, fills: [{ color: "#fff" }], children: [
        { id: "a", type: "rectangle", x: 20, y: 20, width: 100, height: 60, fills: [{ color: "#abc" }] },
        { id: "b", type: "rectangle", x: 200, y: 20, width: 80, height: 60, fills: [{ color: "#cba" }] }
      ] }
    });
    await use(project);
  }
});
test.use({ plugins: ["design"] });

const boardFile = (content: string) => path.join(content, "design/+boards/board.yaml");
const node = async (content: string, id: string) =>
  (parse(await readFile(boardFile(content), "utf8")).spec.root.children as Record<string, unknown>[]).find(child => child.id === id)!;
async function open(page: Page, server: string) {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /inspect-canvas/ }).click();
  await expect(page.getByTestId("design-node-a")).toBeVisible();
}
const settle = (page: Page) => expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saved");
async function clickNode(page: Page, id: string, shift = false) {
  const box = (await page.getByTestId(`design-node-${id}`).boundingBox())!;
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (shift) await page.keyboard.up("Shift");
}

test("fields commit once, step with arrows, accept arithmetic and tokens, and show mixed values @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  const panel = page.getByTestId("design-inspector");
  // Nothing selected: the boards on this page.
  await expect(panel.getByRole("heading", { name: /このページのボード|Boards on this page/ })).toBeVisible();
  await page.getByTestId("design-inspector-board-board").click();
  await expect(page.getByTestId("design-selection")).toHaveAttribute("data-node", "board/root");
  await expect(page.getByTestId("design-field-x")).toHaveCount(0);
  await expect(page.getByTestId("design-field-width")).toHaveValue("500");

  await clickNode(page, "a");
  const x = page.getByTestId("design-field-x");
  await expect(x).toHaveValue("20");
  // Typing does nothing until Enter; arithmetic is evaluated.
  await x.fill("16*2");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "20px");
  await x.press("Enter");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "32px");
  await expect(x).toHaveValue("32");
  // Arrows step by 1 and Shift by 10; quick repeats are one undo step.
  await x.press("ArrowUp");
  await x.press("Shift+ArrowUp");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "43px");
  // Leaving the field commits too; an invalid entry restores the value.
  const width = page.getByTestId("design-field-width");
  await width.fill("150");
  await page.getByTestId("design-field-height").focus();
  await expect(page.getByTestId("design-node-a")).toHaveCSS("width", "150px");
  await width.fill("abc");
  await width.press("Enter");
  await expect(width).toHaveValue("150");
  await page.getByTestId("design-field-rotation").fill("30");
  await page.getByTestId("design-field-rotation").press("Enter");
  await page.getByTestId("design-field-opacity").fill("50");
  await page.getByTestId("design-field-opacity").press("Enter");
  await page.getByTestId("design-field-blend").selectOption("multiply");
  await page.getByTestId("design-field-radius-0").fill("4");
  await page.getByTestId("design-field-radius-0").press("Enter");
  // A token for one corner from the button beside it.
  await page.getByTestId("design-field-radius-2").locator("..").getByTestId("design-token-button").click();
  await page.getByTestId("design-token-radius.m").click();
  await expect(page.getByTestId("design-field-radius-2")).toHaveValue("{radius.m}");
  await settle(page);
  await expect.poll(() => node(project.content, "a")).toMatchObject({
    x: 43, width: 150, rotation: 30, opacity: 0.5, blendMode: "multiply", radius: [4, 0, "{radius.m}", 0]
  });
  await expect(page.getByTestId("design-node-a")).toHaveCSS("border-bottom-right-radius", "12px");

  // Undo from the canvas: six later changes, then the two arrow presses as one step.
  await page.getByTestId("design-viewport").focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Control+z");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "43px");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "32px");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("design-node-a")).toHaveCSS("left", "20px");

  // Several selected nodes: equal values show, different ones read "mixed"; a change applies to all.
  await clickNode(page, "b", true);
  await expect(page.getByTestId("design-inspector-summary")).toHaveText(/2/);
  await expect(page.getByTestId("design-field-y")).toHaveValue("20");
  await expect(page.getByTestId("design-field-x")).toHaveValue("");
  await expect(page.getByTestId("design-field-x")).toHaveAttribute("placeholder", /混在|Mixed/);
  await page.getByTestId("design-field-height").fill("90");
  await page.getByTestId("design-field-height").press("Enter");
  await settle(page);
  await expect.poll(async () => [(await node(project.content, "a")).height, (await node(project.content, "b")).height]).toEqual([90, 90]);

  // The prototype and code tabs have no sections yet; the tabs work with the keyboard.
  await page.getByTestId("design-tab-design").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("design-tab-prototype")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("design-tab-prototype")).toBeFocused();
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});
