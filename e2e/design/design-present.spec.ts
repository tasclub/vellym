import { execFileSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { stringify } from "yaml";
import type { Page } from "@playwright/test";
import { cliPath, test as base, expect } from "../fixtures.js";

const effects = ["instant", "dissolve", "slideIn", "slideOut", "push", "moveIn", "moveOut"] as const;
const directions = ["left", "left", "right", "top", "bottom", "left", "right"] as const;
const node = (id: string, x: number, y: number, reaction: object, children?: object[]) => ({
  id, type: children ? "frame" : "rectangle", x, y, width: 80, height: 32,
  fills: [{ color: "#2563eb" }], reactions: [reaction], ...(children ? { children } : {})
});
const test = base.extend({
  project: async ({ project }, use) => {
    await mkdir(path.join(project.content, "design/+boards"), { recursive: true });
    const write = (file: string, kind: string, name: string, spec: object) =>
      writeFile(path.join(project.content, `design/${file}.yaml`), stringify({
        apiVersion: "vellym.tasclub.com/v1", kind, metadata: { name, title: name }, spec
      }));
    await write("canvas", "DesignCanvas", "playback-canvas", {
      formatVersion: 1, pages: [{ id: "main", title: "Main" }, { id: "other", title: "Other" }, { id: "empty", title: "Empty" }]
    });
    const board = (name: string, width: number, height: number, children: object[], extra = {}) =>
      write(`+boards/${name}`, "DesignBoard", name, {
        canvas: "playback-canvas", page: "main", x: 0, y: 0, ...extra,
        root: { id: "root", type: "frame", width, height, fills: [{ color: "#ffffff" }], children }
      });
    await board("aaa-not-start", 100, 100, []);
    await board("home", 600, 480, [
      ...effects.map((type, i) => node(type, 16 + (i % 4) * 120, 16 + Math.floor(i / 4) * 48, {
        trigger: "click", action: "navigate", destination: "next",
        transition: { type, direction: directions[i], duration: 400, easing: "linear" }
      })),
      node("center", 16, 140, { trigger: "click", action: "overlay", destination: "popup", overlay: { position: "center" } }),
      node("corner", 136, 140, { trigger: "click", action: "overlay", destination: "popup", overlay: { position: "bottomRight" } }),
      node("hover", 16, 200, { trigger: "hover", action: "overlay", destination: "popup" }),
      node("hover-navigate", 136, 200, { trigger: "hover", action: "navigate", destination: "next" }),
      node("press", 256, 200, { trigger: "press", action: "overlay", destination: "popup" }),
      node("safe", 16, 260, { trigger: "click", action: "openUrl", destination: "https://playback.example/help" }),
      node("unsafe", 136, 260, { trigger: "click", action: "openUrl", destination: "javascript:alert(1)" }),
      node("parent", 16, 320, { trigger: "click", action: "navigate", destination: "aaa-not-start" }, [
        node("child", 0, 0, { trigger: "click", action: "overlay", destination: "popup" })
      ]),
      node("sticky", 136, 320, { trigger: "click", action: "overlay", destination: "popup",
        overlay: { closeOnOutsideClick: false, position: "unknown" } }),
      node("hover-covered", 16, 390, { trigger: "hover", action: "overlay", destination: "popup",
        overlay: { position: "bottomLeft" } }),
      node("swap-empty", 136, 390, { trigger: "click", action: "swapOverlay", destination: "popup" }),
      ...["topLeft", "topCenter", "topRight", "bottomLeft", "bottomCenter"].map((position, i) =>
        node(position, 496, 100 + i * 48, { trigger: "click", action: "overlay", destination: "popup", overlay: { position } }))
    ], { startingPoint: true });
    await board("next", 600, 480, [
      node("back", 16, 16, { trigger: "click", action: "back" }),
      node("next-overlay", 16, 100, { trigger: "click", action: "overlay", destination: "popup" })
    ]);
    await board("popup", 180, 140, [
      node("swap", 4, 4, { trigger: "click", action: "swapOverlay", destination: "replacement" }),
      node("close", 4, 48, { trigger: "click", action: "closeOverlay" }),
      node("popup-back", 4, 96, { trigger: "click", action: "back" })
    ]);
    await board("replacement", 160, 120, [
      node("close", 4, 4, { trigger: "click", action: "closeOverlay" }),
      node("navigate", 4, 48, { trigger: "click", action: "navigate", destination: "next" })
    ]);
    await board("other-start", 100, 100, [], { page: "other" });
    await use(project);
  }
});
test.use({ plugins: ["design"] });
const presentation = (page: Page) => page.getByTestId("design-presentation");
const board = (page: Page, name: string) => presentation(page).locator(`[data-presentation-layer="${name}"]:not([aria-hidden])`);
const target = (page: Page, name: string, id: string) => board(page, name).getByTestId(`design-node-${id}`);
async function open(page: Page, origin: string) {
  await page.goto(origin);
  await page.getByRole("treegrid").getByRole("row", { name: /playback-canvas/ }).click();
  await page.getByTestId("design-present").click();
  await expect(board(page, "home")).toBeVisible();
}
async function outside(page: Page) {
  await presentation(page).click({ position: { x: 8, y: 100 } });
}

test("start, transitions and reverse history, modal focus and Esc @DESIGN-A01", async ({ page, server }, testInfo) => {
  await open(page, server);
  await expect(page.getByTestId("design-presentation-close")).toBeFocused();
  const viewport = page.viewportSize()!;
  const modal = (await presentation(page).boundingBox())!;
  expect(modal).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  for (const type of effects) {
    await target(page, "home", type).click();
    await expect(board(page, "next")).toBeVisible();
    if (type !== "instant") {
      const effect = board(page, "next").getByTestId("design-presentation-transition");
      await expect(effect).toHaveCSS("transition-duration", "0.4s, 0.4s");
      await expect(effect).toHaveCSS("transition-timing-function", "linear, linear");
      if (type === "dissolve") {
        expect(await effect.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(1);
      } else {
        const moving = type === "slideOut" || type === "moveOut"
          ? presentation(page).locator('[data-leaving="true"]') : effect;
        await expect.poll(() => moving.evaluate(element => {
          const matrix = new DOMMatrix(getComputedStyle(element).transform);
          return Math.abs(matrix.e) + Math.abs(matrix.f);
        })).toBeGreaterThan(1);
      }
      await expect(presentation(page).locator('[data-leaving="true"]')).toHaveCount(0);
    }
    await target(page, "next", "back").click();
    await expect(board(page, "home")).toBeVisible();
    if (type !== "instant") {
      await expect(board(page, "home").getByTestId("design-presentation-transition")).toHaveCSS("transition-duration", "0.4s, 0.4s");
      await expect(presentation(page).locator('[data-leaving="true"]')).toHaveCount(0);
    }
  }
  expect((await new AxeBuilder({ page }).include('[data-testid="design-presentation"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("presentation.png") });
  await page.keyboard.press("Escape");
  await expect(presentation(page)).toHaveCount(0);
  await expect(page.getByTestId("design-present")).toBeFocused();
  await page.getByTestId("design-page-other").click();
  await page.getByTestId("design-present").click();
  await expect(board(page, "other-start")).toBeVisible();
  await page.getByTestId("design-presentation-close").click();
  await expect(page.getByTestId("design-present")).toBeFocused();
  await page.getByTestId("design-page-empty").click();
  await page.getByTestId("design-present").click();
  await expect(presentation(page)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "There is no board to present." })).toHaveCount(1);
});

test("overlay placement, outside, swap, close, back, press, nested nodes and hover @DESIGN-A01", async ({ page, server }) => {
  await open(page, server);
  const baseBox = (await board(page, "home").boundingBox())!;
  for (const position of ["center", "corner"]) {
    await target(page, "home", position).click();
    const popup = board(page, "popup");
    await expect(popup).toBeVisible();
    const box = (await popup.boundingBox())!;
    expect(box.x).toBeCloseTo(baseBox.x + (baseBox.width - box.width) * (position === "center" ? 0.5 : 1), 1);
    expect(box.y).toBeCloseTo(baseBox.y + (baseBox.height - box.height) * (position === "center" ? 0.5 : 1), 1);
    await outside(page);
    await expect(popup).toHaveCount(0);
  }
  for (const [position, x, y] of [["topLeft", 0, 0], ["topCenter", 0.5, 0], ["topRight", 1, 0],
    ["bottomLeft", 0, 1], ["bottomCenter", 0.5, 1]] as const) {
    await target(page, "home", position).click();
    const box = (await board(page, "popup").boundingBox())!;
    expect(box.x).toBeCloseTo(baseBox.x + (baseBox.width - box.width) * x, 1);
    expect(box.y).toBeCloseTo(baseBox.y + (baseBox.height - box.height) * y, 1);
    await outside(page);
  }
  await target(page, "home", "swap-empty").click();
  await expect(board(page, "popup")).toBeVisible();
  await target(page, "popup", "close").click();
  await target(page, "home", "center").click();
  await target(page, "popup", "swap").click();
  await expect(board(page, "popup")).toHaveCount(0);
  await target(page, "replacement", "close").click();
  await expect(board(page, "replacement")).toHaveCount(0);
  await target(page, "home", "center").click();
  await target(page, "popup", "popup-back").click();
  await expect(board(page, "popup")).toHaveCount(0);
  await target(page, "home", "child").click();
  await expect(board(page, "home")).toBeVisible();
  await expect(board(page, "popup")).toBeVisible();
  await target(page, "popup", "close").click();
  await target(page, "home", "sticky").click();
  await outside(page);
  await expect(board(page, "popup")).toBeVisible();
  await target(page, "popup", "close").click();
  const press = (await target(page, "home", "press").boundingBox())!;
  await page.mouse.move(press.x + 10, press.y + 10);
  await page.mouse.down();
  await expect(board(page, "popup")).toBeVisible();
  await page.mouse.up();
  await target(page, "popup", "close").click();
  for (const [id, name] of [["hover", "popup"], ["hover-navigate", "next"], ["hover-covered", "popup"]] as const) {
    await target(page, "home", id).hover();
    await expect(board(page, name)).toBeVisible();
    await page.mouse.move(8, 100);
    await expect(board(page, name)).toHaveCount(0);
    await expect(board(page, "home")).toBeVisible();
  }
  // Navigate clears every overlay, and back restores the board, not an overlay.
  await target(page, "home", "center").click();
  await target(page, "popup", "swap").click();
  await target(page, "replacement", "navigate").click();
  await expect(board(page, "replacement")).toHaveCount(0);
  await target(page, "next", "back").click();
  await expect(board(page, "home")).toBeVisible();
  await expect(board(page, "popup")).toHaveCount(0);
  await target(page, "home", "center").click();
  await page.keyboard.press("Escape");
  await expect(presentation(page)).toHaveCount(0);
  await expect(page.getByTestId("design-present")).toBeFocused();
});

test("safe external tab, blocked script URL, reduced motion @DESIGN-A01", async ({ page, server, context }) => {
  await context.route("https://playback.example/**", route => route.fulfill({ body: "<title>Help fixture</title>" }));
  await open(page, server);
  const opened = context.waitForEvent("page");
  await target(page, "home", "safe").click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toBe("https://playback.example/help");
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await tab.close();
  const count = context.pages().length;
  await target(page, "home", "unsafe").click();
  await expect(presentation(page).getByRole("status")).toHaveText("This URL cannot be opened");
  expect(context.pages()).toHaveLength(count);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const type of effects) {
    await target(page, "home", type).click();
    await expect(board(page, "next")).toBeVisible();
    await expect(board(page, "next").getByTestId("design-presentation-transition")).toHaveCSS("transition-duration", "0s");
    await expect(presentation(page).locator('[data-leaving="true"]')).toHaveCount(0);
    await target(page, "next", "back").click();
  }
});

test("static playback, resize scaling and navigation @DESIGN-F01", async ({ page, project, staticServer }) => {
  test.setTimeout(120_000);
  execFileSync(process.execPath, [cliPath, "build", "--config", project.config], { timeout: 90_000 });
  const [build] = await readdir(path.join(project.root, "dist"));
  const origin = await staticServer(path.join(project.root, "dist", build!), "/site");
  await open(page, `${origin}/site/`);
  await page.setViewportSize({ width: 500, height: 450 });
  await expect.poll(async () => (await board(page, "home").boundingBox())!.width).toBeCloseTo(436, 1);
  await target(page, "home", "center").click();
  const popup = (await board(page, "popup").boundingBox())!;
  expect(popup.width).toBeCloseTo(180 * 436 / 600, 1);
  await target(page, "popup", "close").click();
  await target(page, "home", "instant").click();
  await expect(board(page, "next")).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[data-testid="design-presentation"]').analyze()).violations).toEqual([]);
});
