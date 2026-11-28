import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { parse, stringify } from "yaml";
import { cliPath, test as base, expect } from "../fixtures.js";
import type { Page } from "@playwright/test";

const test = base.extend({
  project: async ({ project }, use) => {
    await mkdir(path.join(project.content, "design/+boards"), { recursive: true });
    const write = (file: string, kind: string, name: string, title: string, spec: unknown) =>
      writeFile(path.join(project.content, `design/${file}.yaml`), stringify({
        apiVersion: "vellym.tasclub.com/v1", kind, metadata: { name, title }, spec
      }));
    await write("canvas", "DesignCanvas", "canvas", "Navigation canvas", {
      formatVersion: 1, pages: [{ id: "main", title: "Main page" }, { id: "second", title: "Second page" }, { id: "empty", title: "Empty page" }],
      notes: [{ page: "main", x: 20, y: 290, text: "Main annotation", kind: "title" },
        { page: "main", x: 350, y: 290, text: "<script>plain text</script>", kind: "sticky" },
        { page: "second", x: 20, y: 290, text: "Second annotation", kind: "sticky" }]
    });
    await write("empty", "DesignCanvas", "empty-canvas", "Empty canvas", { formatVersion: 1 });
    for (const [name, page, x, y, color] of [
      ["first-board", "main", -20, 10, "#ffffff"], ["far-board", "main", 2400, 1600, "#ffffff"],
      ["second-board", "second", 40, 20, "#dbeafe"]
    ] as const) {
      await write(`+boards/${name}`, "DesignBoard", name, name, {
        canvas: "canvas", page, x, y, root: { id: "root", type: "frame", width: 240, height: 160,
          fills: [{ color }], children: [{ id: "caption", type: "text", x: 12, y: 12, text: name, fontSize: 16 }] }
      });
    }
    await use(project);
  }
});
test.use({ plugins: ["design"] });

test.describe("canvas creation", () => {
  test.use({
    project: async ({ project }, use) => {
      const config = parse(await readFile(project.config, "utf8"));
      config.ui.language = "ja";
      config.i18n.defaultLocale = "ja";
      await writeFile(project.config, stringify(config));
      await use(project);
    }
  });

  test("Japanese canvases in the chosen folder, bodyless drafts and immediate boards @DESIGN-A01", async ({ page, server, project }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server);
    const title = "画面の設計";
    const create = async () => {
      await page.getByRole("button", { name: "新規作成", exact: true }).click();
      await page.getByRole("menuitem", { name: "デザインキャンバスを作成", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill(title);
      await dialog.getByRole("button", { name: "デザインキャンバスを作成", exact: true }).click();
      await expect(page.getByTestId("document-save")).toBeVisible();
      await expect(page.getByRole("group", { name: "書式", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /見出し2|画像を挿入/ })).toHaveCount(0);
      await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
      await expect(page.locator(".page-editor-surface")).toHaveAttribute("data-plugin-paper-width", "full");
      await expect(page.locator(".page-editor-surface input")).toHaveValue(title);
      // Boards need a saved canvas: an unsaved draft offers no immediate creation.
      await expect(page.getByTestId("design-add-board")).toHaveCount(0);
      await page.getByTestId("document-save").click();
      await expect(page.getByTestId("document-save")).toHaveCount(0);
      await expect(page.getByTestId("design-add-board")).toBeVisible();
    };
    // Select a root document so the canvas is created at the content root.
    await page.getByRole("treegrid").getByRole("row", { name: /Fixture topic/ }).click();
    await create();
    // The canvas sits directly in the chosen folder (the content root): no folder of its own.
    const folder = project.content;
    const canvasesIn = async () => (await Promise.all((await readdir(folder)).filter(file => file.endsWith(".yaml"))
      .map(async file => parse(await readFile(path.join(folder, file), "utf8"))))).filter(item => item.kind === "DesignCanvas");
    expect(await readdir(folder)).not.toContain(title);
    const [canvas, ...others] = await canvasesIn();
    expect(others).toHaveLength(0);
    const tree = page.getByRole("treegrid").first();
    await expect(tree.getByRole("row", { name: title, exact: true })).toHaveAttribute("aria-level", "1");
    await expect(tree.getByRole("button", { name: new RegExp(`^(フォルダ|Open).*${title}`) })).toHaveCount(0);
    expect(canvas.metadata.title).toBe(title);
    expect(canvas.metadata.name).toMatch(/^design-canvas-/);
    const paper = page.locator(".browse-workspace > .document-paper");
    await expect(paper).toHaveAttribute("data-plugin-paper-width", "full");
    await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
    const canvasBox = (await page.getByTestId("design-canvas").boundingBox())!;
    const workspaceBox = (await page.locator(".browse-workspace").boundingBox())!;
    expect(canvasBox.width).toBeGreaterThanOrEqual(800);
    expect(workspaceBox.width - canvasBox.width).toBeLessThan(180);
    expect((await page.getByTestId("design-viewport").boundingBox())!.height).toBeGreaterThanOrEqual(480);
    const url = page.url();
    for (let number = 1; number <= 2; number++) {
      await page.getByTestId("design-add-board").click();
      await expect(page.getByRole("button", { name: `ボード ${number}`, exact: true })).toBeVisible();
      await expect(page.getByTestId("design-add-board")).toBeEnabled();
      expect(page.url()).toBe(url);
      await expect(page.getByTestId("document-save")).toHaveCount(0);
    }
    const boardFiles = (await readdir(path.join(folder, "+boards"))).filter(file => file.endsWith(".yaml"));
    expect(boardFiles).toHaveLength(2);
    const boards = await Promise.all(boardFiles.map(async file =>
      parse(await readFile(path.join(folder, "+boards", file), "utf8"))));
    expect(boards.map(board => board.metadata.title).sort()).toEqual(["ボード 1", "ボード 2"]);
    expect(boards.every(board => board.spec.canvas === canvas.metadata.name)).toBe(true);
    expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
    await page.getByTestId("design-hand").click();
    await expect(page.getByTestId("design-hand")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("design-hand")).not.toHaveCSS("background-color",
      await page.getByTestId("design-zoom-reset").evaluate(element => getComputedStyle(element).backgroundColor));
    await page.screenshot({ path: testInfo.outputPath("full-canvas.png") });
    await page.reload();
    await expect(page.getByRole("button", { name: /^ボード [12]$/ })).toHaveCount(2);
    // Creating from the open canvas puts the next canvas beside it, and the boards stay with their canvas.
    await create();
    expect((await canvasesIn()).map(item => item.metadata.title)).toEqual([title, title]);
    expect((await readdir(path.join(folder, "+boards"))).filter(file => file.endsWith(".yaml"))).toHaveLength(2);
  });
});

async function openCanvas(page: Page, origin: string) {
  await page.goto(origin);
  await page.getByRole("treegrid").getByRole("row", { name: /Navigation canvas/ }).click();
  await expect(page.getByTestId("design-board-first-board").getByTestId("design-node-caption")).toHaveText("first-board");
}
async function view(page: Page) {
  return page.getByTestId("design-board-stage").evaluate(element => {
    const matrix = new DOMMatrix((element as HTMLElement).style.transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
}

test("wheel, cursor-centered zoom, hand and space drag only transform the world @DESIGN-A01", async ({ page, server }) => {
  await openCanvas(page, server);
  const viewport = page.getByTestId("design-viewport");
  const box = (await viewport.boundingBox())!;
  const px = Math.round(box.x + 180), py = Math.round(box.y + 160);
  const localX = px - box.x, localY = py - box.y;
  const start = await view(page);
  await page.getByTestId("design-board-first-board").evaluate(element => {
    (window as unknown as { boardMutations: number }).boardMutations = 0;
    new MutationObserver(records => {
      (window as unknown as { boardMutations: number }).boardMutations += records.length;
    }).observe(element.shadowRoot!, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.mouse.move(px, py);
  await page.mouse.wheel(25, 45);
  await expect.poll(() => view(page)).toEqual({ ...start, x: start.x - 25, y: start.y - 45 });
  for (const modifier of ["Control", "Meta"] as const) {
    const before = await view(page);
    await page.keyboard.down(modifier);
    await page.mouse.wheel(0, -25);
    await page.keyboard.up(modifier);
    await expect.poll(async () => (await view(page)).scale).toBeGreaterThan(before.scale);
    const after = await view(page);
    // Chromium serializes CSS transform numbers with limited precision (< 0.01px here).
    expect((localX - before.x) / before.scale).toBeCloseTo((localX - after.x) / after.scale, 2);
    expect((localY - before.y) / before.scale).toBeCloseTo((localY - after.y) / after.scale, 2);
  }
  await page.getByTestId("design-hand").click();
  const beforeDrag = await view(page);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 45, py + 30, { steps: 4 });
  await page.mouse.up();
  const afterDrag = await view(page);
  expect(afterDrag.x).toBeCloseTo(beforeDrag.x + 45, 2);
  expect(afterDrag.y).toBeCloseTo(beforeDrag.y + 30, 2);
  expect(afterDrag.scale).toBe(beforeDrag.scale);
  await page.getByTestId("design-hand").click();
  await viewport.focus();
  await page.keyboard.down("Space");
  const beforeSpace = await view(page);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px - 30, py - 20);
  await page.mouse.up();
  await page.keyboard.up("Space");
  const afterSpace = await view(page);
  expect(afterSpace.x).toBeCloseTo(beforeSpace.x - 30, 2);
  expect(afterSpace.y).toBeCloseTo(beforeSpace.y - 20, 2);
  expect(afterSpace.scale).toBe(beforeSpace.scale);
  expect(await page.evaluate(() => (window as unknown as { boardMutations: number }).boardMutations)).toBe(0);
  await page.keyboard.press("h");
  await expect(page.getByTestId("design-hand")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(page.getByTestId("design-hand")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Shift+Digit0");
  expect((await view(page)).scale).toBe(1);
  await expect(page.getByTestId("design-zoom")).toHaveText("100%");
});

test("fit all, board labels, selection, annotations and offscreen boards @DESIGN-A01", async ({ page, server }, testInfo) => {
  await openCanvas(page, server);
  const viewport = page.getByTestId("design-viewport");
  await expect(page.getByTestId("design-board-far-board")).toHaveCSS("content-visibility", "auto");
  await expect(page.getByTestId("design-board-far-board")).toHaveCSS("contain-intrinsic-size", /(?:auto )?240px (?:auto )?160px/);
  await expect(page.getByTestId("design-note")).toHaveCount(2);
  await expect(page.getByTestId("design-note").nth(1)).toHaveText("<script>plain text</script>");
  await viewport.focus();
  await page.keyboard.press("Shift+Digit1");
  const all = await view(page);
  expect(all.scale).toBeLessThan(1);
  const viewportBox = (await viewport.boundingBox())!;
  for (const id of ["first-board", "far-board"]) {
    const boardBox = (await page.getByTestId(`design-board-${id}`).boundingBox())!;
    expect(boardBox.x).toBeGreaterThanOrEqual(viewportBox.x);
    expect(boardBox.y).toBeGreaterThanOrEqual(viewportBox.y);
    expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
    expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);
  }
  await page.getByTestId("design-board-label-first-board").click();
  await page.keyboard.press("Shift+Digit2");
  expect((await view(page)).scale).toBeGreaterThan(all.scale);
  await expect(page.getByTestId("design-board-label-first-board")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("design-board-first-board").getByTestId("design-node-root")).toHaveCSS("background-image", /255|fff/);
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
  const screenshot = testInfo.outputPath("canvas.png");
  await page.getByTestId("design-canvas").screenshot({ path: screenshot });
  await testInfo.attach("canvas", { path: screenshot, contentType: "image/png" });
});

test("touch pinch keeps the midpoint anchored @DESIGN-A01", async ({ page, server }) => {
  await openCanvas(page, server);
  const box = (await page.getByTestId("design-viewport").boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const x = Math.round(box.x + 240), y = Math.round(box.y + 200);
  const before = await view(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart",
    touchPoints: [{ x: x - 40, y, id: 1 }, { x: x + 40, y, id: 2 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove",
    touchPoints: [{ x: x - 80, y, id: 1 }, { x: x + 80, y, id: 2 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const after = await view(page);
  expect(after.scale).toBeCloseTo(before.scale * 2, 3);
  expect((x - box.x - before.x) / before.scale).toBeCloseTo((x - box.x - after.x) / after.scale, 3);
  expect((y - box.y - before.y) / before.scale).toBeCloseTo((y - box.y - after.y) / after.scale, 3);
  await client.detach();
});

test("page tabs work with mouse and keyboard, including an empty page and canvas @DESIGN-A01", async ({ page, server }) => {
  await openCanvas(page, server);
  await page.getByTestId("design-page-second").click();
  await expect(page.getByTestId("design-board-first-board")).toHaveCount(0);
  await expect(page.getByTestId("design-board-second-board")).toBeVisible();
  await expect(page.getByTestId("design-note")).toHaveText("Second annotation");
  await page.getByTestId("design-page-second").press("ArrowDown");
  await expect(page.getByTestId("design-page-empty")).toBeFocused();
  await expect(page.getByTestId("design-empty")).toBeVisible();
  await expect(page.getByTestId("design-board-second-board")).toHaveCount(0);
  await page.getByTestId("design-page-empty").press("Home");
  await expect(page.getByTestId("design-board-first-board")).toBeVisible();
  await page.getByRole("treegrid").getByRole("row", { name: /Empty canvas/ }).click();
  await expect(page.getByTestId("design-empty")).toBeVisible();
  await expect(page.getByTestId("design-pages")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});

test("static build preserves boards, notes and navigation without editing @DESIGN-F01", async ({ page, project, staticServer }) => {
  test.setTimeout(120_000);
  execFileSync(process.execPath, [cliPath, "build", "--config", project.config], { timeout: 90_000 });
  const [build] = await readdir(path.join(project.root, "dist"));
  const origin = await staticServer(path.join(project.root, "dist", build!), "/site");
  await openCanvas(page, `${origin}/site/`);
  await expect(page.getByTestId("design-add-board")).toHaveCount(0);
  await expect(page.getByTestId("design-board-first-board").getByTestId("design-node-root")).toHaveCSS("width", "240px");
  await expect(page.getByTestId("design-note")).toHaveCount(2);
  await page.getByTestId("design-zoom-fit").click();
  expect((await view(page)).scale).toBeLessThan(1);
  await page.getByTestId("design-page-second").click();
  await expect(page.getByTestId("design-board-second-board").getByTestId("design-node-caption")).toHaveText("second-board");
  await expect(page.getByTestId("design-note")).toHaveText("Second annotation");
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
  await page.getByTestId("design-page-empty").click();
  await expect(page.getByTestId("design-empty")).toHaveText("There are no boards on this page.");
});
