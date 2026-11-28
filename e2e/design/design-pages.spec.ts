import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
    // No pages yet: the board is on "the first page".
    await write("canvas", "DesignCanvas", "pages-canvas", { formatVersion: 1 });
    await write("+boards/home", "DesignBoard", "home", {
      canvas: "pages-canvas", x: 40, y: 40, root: { id: "root", type: "frame", width: 300, height: 200, fills: [{ color: "#fff" }], children: [] }
    });
    await use(project);
  }
});
test.use({ plugins: ["design"] });

const canvasFile = (content: string) => path.join(content, "design/canvas.yaml");
const pagesOf = async (content: string) => parse(await readFile(canvasFile(content), "utf8")).spec.pages;
const boardPage = async (content: string, name: string) => parse(await readFile(path.join(content, `design/+boards/${name}.yaml`), "utf8")).spec.page;
const settle = (page: Page) => expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saved");

test("add, rename, reorder and delete pages; boards stay on their page; undo @DESIGN-A01", async ({ page, server, project }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /pages-canvas/ }).click();
  await expect(page.getByTestId("design-board-home")).toBeVisible();
  await page.getByTestId("design-left-tab-pages").click();
  await expect(page.getByTestId("design-left-panel")).toContainText(/ページはありません|no pages/);

  // The first page takes the existing board; the second is empty and opens.
  await page.getByTestId("design-page-add").click();
  await page.getByTestId("design-page-add").click();
  await settle(page);
  await expect.poll(() => pagesOf(project.content)).toEqual([{ id: "page-1", title: "Page 1" }, { id: "page-2", title: "Page 2" }]);
  await expect(page.getByTestId("design-page-page-2")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("design-empty")).toBeVisible();
  await page.getByTestId("design-page-page-1").click();
  await expect(page.getByTestId("design-board-home")).toBeVisible();

  // Rename with a double-click and with F2.
  await page.getByTestId("design-page-page-1").dblclick();
  await page.getByTestId("design-page-rename").fill("画面");
  await page.getByTestId("design-page-rename").press("Enter");
  await page.getByTestId("design-page-page-2").focus();
  await page.keyboard.press("F2");
  await page.getByTestId("design-page-rename").fill("部品");
  await page.getByTestId("design-page-rename").press("Enter");
  await settle(page);
  await expect.poll(async () => (await pagesOf(project.content)).map((item: { title: string }) => item.title)).toEqual(["画面", "部品"]);

  // Moving 部品 to the top keeps the board on 画面: it gets an explicit page in the same step.
  await page.getByTestId("design-page-page-2").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await settle(page);
  await expect.poll(async () => (await pagesOf(project.content)).map((item: { id: string }) => item.id)).toEqual(["page-2", "page-1"]);
  await expect.poll(() => boardPage(project.content, "home")).toBe("page-1");
  await page.getByTestId("design-page-page-1").click();
  await expect(page.getByTestId("design-board-home")).toBeVisible();
  // One undo puts back both the order and the board's implicit page.
  await page.getByTestId("design-viewport").focus();
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect.poll(async () => (await pagesOf(project.content)).map((item: { id: string }) => item.id)).toEqual(["page-1", "page-2"]);
  await expect.poll(() => boardPage(project.content, "home")).toBeUndefined();

  // Dragging reorders too.
  await page.getByTestId("design-page-page-2").dragTo(page.getByTestId("design-page-page-1"), { targetPosition: { x: 20, y: 2 } });
  await settle(page);
  await expect.poll(async () => (await pagesOf(project.content)).map((item: { id: string }) => item.id)).toEqual(["page-2", "page-1"]);

  // Deleting a page with boards asks first; cancel keeps it; OK deletes the page and its board.
  await page.getByTestId("design-page-page-1").click();
  await page.getByTestId("design-page-delete").click();
  await expect(page.getByTestId("design-page-confirm")).toContainText("1");
  await page.getByTestId("design-page-confirm-cancel").click();
  await expect(page.getByTestId("design-page-page-1")).toBeVisible();
  await page.getByTestId("design-page-delete").click();
  await page.getByTestId("design-page-confirm-ok").click();
  await settle(page);
  await expect.poll(async () => (await pagesOf(project.content)).map((item: { id: string }) => item.id)).toEqual(["page-2"]);
  expect((await readdir(path.join(project.content, "design/+boards"))).filter(file => file.endsWith(".yaml"))).toEqual([]);
  // The last page cannot be deleted.
  await expect(page.getByTestId("design-page-delete")).toHaveCount(0);
  // Saving the page list and the board together, and deleting a board, never reload the canvas.
  await expect(page.getByTestId("design-reloaded")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});
