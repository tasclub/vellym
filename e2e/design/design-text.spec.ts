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
    await write("canvas", "DesignCanvas", "text-canvas", { formatVersion: 1 });
    await write("+boards/board", "DesignBoard", "board", {
      canvas: "text-canvas", x: 40, y: 40,
      root: { id: "root", type: "frame", width: 600, height: 400, fills: [{ color: "#fff" }], children: [
        { id: "title", type: "text", x: 20, y: 300, text: "見出し", fontSize: 20, fills: [{ color: "#111111" }] }
      ] }
    });
    await use(project);
  }
});
test.use({ plugins: ["design"] });

const boardFile = (content: string) => path.join(content, "design/+boards/board.yaml");
const node = async (content: string, id: string) =>
  (parse(await readFile(boardFile(content), "utf8")).spec.root.children as Record<string, unknown>[]).find(child => child.id === id);
const settle = (page: Page) => expect(page.getByTestId("design-save-status")).toHaveAttribute("data-state", "saved");
async function open(page: Page, server: string) {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /text-canvas/ }).click();
  await expect(page.getByTestId("design-node-title")).toBeVisible();
  await page.getByTestId("design-zoom-reset").click();
}

test("T places text and edits at once; Japanese input composes without touching the model @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  const board = (await page.getByTestId("design-board-board").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await page.getByTestId("design-viewport").focus();
  await page.keyboard.press("t");
  await expect(page.getByTestId("design-tool-text")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(board.x + 40, board.y + 40);
  const editor = page.getByTestId("design-text-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.type("価格 ");
  // Composing: the model (and the saved file) does not change until the edit ends.
  await cdp.send("Input.imeSetComposition", { text: "にほん", selectionStart: 3, selectionEnd: 3 });
  await expect(editor).toContainText("にほん");
  expect(await node(project.content, "text-1")).toBeUndefined();
  await cdp.send("Input.imeSetComposition", { text: "日本", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.insertText", { text: "日本" });
  // Escape during composition would cancel the composition; after it, Escape finishes the edit.
  await page.keyboard.press("Enter");
  await page.keyboard.type("2行目");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await settle(page);
  await expect.poll(() => node(project.content, "text-1")).toMatchObject({ type: "text", text: "価格 日本\n2行目", autoResize: "widthAndHeight", x: 40, y: 40 });
  await expect(page.getByTestId("design-node-text-1")).toHaveText("価格 日本\n2行目");
  await expect(page.getByTestId("design-tool-select")).toHaveAttribute("aria-pressed", "true");

  // Double-click existing text: the caret goes to the end; Ctrl+Enter finishes.
  const title = (await page.getByTestId("design-node-title").boundingBox())!;
  await page.mouse.dblclick(title.x + title.width / 2, title.y + title.height / 2);
  await expect(editor).toBeFocused();
  await cdp.send("Input.imeSetComposition", { text: "ご", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.insertText", { text: "語" });
  await page.keyboard.press("Control+Enter");
  await settle(page);
  await expect.poll(async () => (await node(project.content, "title"))?.text).toBe("見出し語");

  // An empty new text disappears again.
  await page.keyboard.press("t");
  await page.mouse.click(board.x + 300, board.y + 200);
  await expect(editor).toBeFocused();
  await page.keyboard.press("Escape");
  await settle(page);
  expect(await node(project.content, "text-2")).toBeUndefined();
});

test("formatting: whole text from the panel, a selected part becomes its own run @DESIGN-A01", async ({ page, server, project }) => {
  await open(page, server);
  const title = page.getByTestId("design-node-title");
  const box = (await title.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.getByTestId("design-inspector");
  await expect(panel.getByRole("heading", { name: /^(文字|Text)$/ })).toBeVisible();
  await page.getByTestId("design-field-font-size").fill("32");
  await page.getByTestId("design-field-font-size").press("Enter");
  await page.getByTestId("design-field-text-align").selectOption("center");
  await page.getByTestId("design-field-text-decoration").selectOption("underline");
  await page.getByTestId("design-field-letter-spacing").fill("2");
  await page.getByTestId("design-field-letter-spacing").press("Enter");
  await page.getByTestId("design-field-line-height").fill("150%");
  await page.getByTestId("design-field-line-height").press("Enter");
  await page.getByTestId("design-field-auto-resize").selectOption("none");
  await page.getByTestId("design-field-vertical-align").selectOption("bottom");
  await settle(page);
  await expect.poll(() => node(project.content, "title")).toMatchObject({
    fontSize: 32, textAlign: "center", textDecoration: "underline", letterSpacing: 2, lineHeight: "150%", autoResize: "none", verticalAlign: "bottom"
  });
  await expect(title).toHaveCSS("font-size", "32px");
  await expect(title).toHaveCSS("justify-content", "flex-end");

  // Select the last character while editing, then make it bold from the panel.
  const bigger = (await title.boundingBox())!;
  await page.mouse.dblclick(bigger.x + bigger.width / 2, bigger.y + bigger.height - 10);
  const editor = page.getByTestId("design-text-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.getByTestId("design-text-range")).toContainText("1");
  await page.getByTestId("design-field-font-weight").selectOption("700");
  await settle(page);
  await expect.poll(async () => (await node(project.content, "title"))?.spans).toEqual([{ text: "見出" }, { text: "し", fontWeight: 700 }]);
  expect(await node(project.content, "title")).not.toHaveProperty("text");
  await expect(title.locator("span").nth(1)).toHaveCSS("font-weight", "700");
  // "Apply to all" returns to whole-text formatting.
  await page.getByTestId("design-text-range").getByRole("button").click();
  await page.getByTestId("design-field-font-weight").selectOption("400");
  await settle(page);
  await expect.poll(async () => (await node(project.content, "title"))?.text).toBe("見出し");
  expect((await new AxeBuilder({ page }).include('[data-testid="design-canvas"]').analyze()).violations).toEqual([]);
});
