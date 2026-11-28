import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
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
    await write("canvas", "DesignCanvas", "selection-canvas", {
      formatVersion: 1, pages: [{ id: "one" }, { id: "two" }]
    });
    await write("+boards/board", "DesignBoard", "board", {
      canvas: "selection-canvas", x: 40, y: 40,
      root: { id: "root", type: "frame", width: 550, height: 350, fills: [{ color: "#fff" }], children: [
        { id: "group", type: "group", x: 20, y: 20, width: 160, height: 140, rotation: 10, children: [
          { id: "inner", type: "group", x: 20, y: 20, width: 90, height: 80, children: [
            { id: "leaf", type: "rectangle", x: 10, y: 10, width: 40, height: 30, fills: [{ color: "#abc" }] }
          ] }
        ] },
        { id: "rotated", type: "rectangle", x: 250, y: 30, width: 100, height: 70, rotation: 30, fills: [{ color: "#def" }] },
        { id: "under", type: "rectangle", x: 250, y: 200, width: 100, height: 80, fills: [{ color: "#bcd" }] },
        { id: "locked", type: "group", locked: true, x: 250, y: 200, width: 100, height: 80, children: [
          { id: "locked-child", type: "rectangle", width: 100, height: 80, fills: [{ color: "#cde" }] }
        ] },
        { id: "hidden", type: "rectangle", visible: false, x: 400, y: 200, width: 80, height: 80, fills: [{ color: "#fed" }] }
      ] }
    });
    await use(project);
  }
});
test.use({ plugins: ["design"] });

async function open(page: Page, server: string) {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /selection-canvas/ }).click();
  await expect(page.getByTestId("design-node-leaf")).toBeVisible();
}
async function point(page: Page, id: string) {
  const box = (await page.getByTestId(`design-node-${id}`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function click(page: Page, id: string) {
  const p = await point(page, id);
  await page.mouse.click(p.x, p.y);
}
async function selected(page: Page, ids: string[]) {
  await expect.poll(() => page.getByTestId("design-selection").evaluateAll(elements =>
    elements.map(element => element.getAttribute("data-node")).sort())).toEqual(ids.map(id => `board/${id}`).sort());
}

test("nested, deep, multiple, locked and hidden selection @DESIGN-A01", async ({ page, server }, info) => {
  await open(page, server);
  await click(page, "leaf");
  await selected(page, ["group"]);
  await expect(page.getByTestId("design-selection")).toHaveCSS("transform", /matrix\(0.984808, 0.173648, -0.173648, 0.984808/);
  await page.keyboard.press("Enter");
  await selected(page, ["inner"]);
  await page.keyboard.press("Enter");
  await selected(page, ["leaf"]);
  await page.keyboard.press("Shift+Enter");
  await selected(page, ["inner"]);
  await page.keyboard.press("Escape");
  await selected(page, []);
  const leaf = await point(page, "leaf");
  await page.mouse.dblclick(leaf.x, leaf.y);
  await selected(page, ["inner"]);
  for (const modifier of ["Control", "Meta"] as const) {
    await page.keyboard.press("Escape");
    await page.keyboard.down(modifier);
    await click(page, "leaf");
    await page.keyboard.up(modifier);
    await selected(page, ["leaf"]);
  }
  await page.keyboard.press("Escape");
  await click(page, "leaf");
  await page.keyboard.down("Shift");
  await click(page, "rotated");
  await page.keyboard.up("Shift");
  await selected(page, ["group", "rotated"]);
  await expect(page.getByTestId("design-selection-status")).toHaveText("2 selected");
  await page.keyboard.down("Shift");
  await click(page, "rotated");
  await page.keyboard.up("Shift");
  await selected(page, ["group"]);
  await click(page, "locked-child");
  await selected(page, ["under"]);
  // The hidden element's location instead hits the visible board root.
  const root = (await page.getByTestId("design-node-root").boundingBox())!;
  await page.mouse.click(root.x + 440, root.y + 240);
  await selected(page, ["root"]);
  await page.getByTestId("design-hand").click();
  await click(page, "leaf");
  await selected(page, ["root"]);
  await page.getByTestId("design-hand").click();
  await page.getByTestId("design-viewport").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.down("Space");
  await click(page, "leaf");
  await selected(page, []);
  await page.keyboard.up("Space");
  const p = await point(page, "rotated");
  await page.mouse.move(p.x, p.y);
  await expect(page.getByTestId("design-hover")).toHaveAttribute("data-node", "board/rotated");
  await page.mouse.click(p.x, p.y);
  await selected(page, ["rotated"]);
  await expect(page.getByTestId("design-hover")).toHaveCount(0);
  await expect(page.getByTestId("design-selection")).toHaveCSS("transform", /matrix\(0.866025, 0.5, -0.5, 0.866025/);
  const assertAligned = async () => {
    const node = (await page.getByTestId("design-node-rotated").boundingBox())!;
    const frame = (await page.getByTestId("design-selection").boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const) expect(frame[key]).toBeCloseTo(node[key], 1);
  };
  await assertAligned();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -35);
  await page.keyboard.up("Control");
  await expect(page.getByTestId("design-zoom")).not.toHaveText("100%");
  await assertAligned();
  const thickness = await page.getByTestId("design-selection").evaluate(element =>
    Number(getComputedStyle(element).boxShadow.match(/([\d.]+)px(?: inset)?$/)![1]) *
    Number((element.closest('[data-testid="design-board-stage"]') as HTMLElement).style.getPropertyValue("--design-scale")));
  expect(thickness).toBeCloseTo(2, 3);
  await page.getByTestId("design-zoom-selection").click();
  await assertAligned();
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("selection.png") });
  await page.getByTestId("design-page-two").click();
  await selected(page, []);
  await expect(page.getByTestId("design-zoom-selection")).toBeDisabled();
});

test("marquee selects overlapping children or a fully enclosed board @DESIGN-A01", async ({ page, server }) => {
  await open(page, server);
  const root = (await page.getByTestId("design-node-root").boundingBox())!;
  const drag = async (right: number, bottom: number) => {
    await page.mouse.move(root.x - 10, root.y - 10);
    await page.mouse.down();
    await page.mouse.move(root.x + right, root.y + bottom, { steps: 5 });
    await expect(page.getByTestId("design-marquee")).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId("design-marquee")).toHaveCount(0);
  };
  await drag(370, 170);
  await selected(page, ["group", "rotated"]);
  await page.keyboard.press("Escape");
  await selected(page, []);
  await click(page, "locked-child");
  await selected(page, ["under"]);
  await page.keyboard.down("Shift");
  await drag(370, 170);
  await page.keyboard.up("Shift");
  await selected(page, ["group", "rotated", "under"]);
  await page.keyboard.press("Escape");
  await drag(root.width + 10, root.height + 10);
  await selected(page, ["root"]);
  await page.keyboard.press("Enter");
  await selected(page, ["group", "rotated", "under"]);
});
