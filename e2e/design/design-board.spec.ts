import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { test as base, expect } from "../fixtures.js";

const children = [
  { id: "rect", type: "rectangle", x: 12, y: 15, width: 100, height: 60, styles: ["accent"],
    strokes: [{ color: "#f00" }, { type: "linearGradient", stops: [{ position: 0, color: "#f00" }, { position: 1, color: "#00f" }] }],
    strokeWidth: 4, strokeDash: [8, 3] },
  { id: "label", type: "text", x: 130, y: 15, width: 140, height: 40, autoResize: "none",
    fontFamily: "sans-serif", fontSize: 16, spans: [{ text: "Hello " }, { text: "board", fontWeight: 700, fills: [{ color: "#123456" }] }] },
  { id: "image", type: "image", x: 300, y: 15, width: 60, height: 40, asset: "pixel.png", fit: "contain" },
  { id: "ellipse", type: "ellipse", x: 12, y: 95, width: 90, height: 50, fills: [{ color: "{color.accent}" }],
    strokes: [{ color: "#000" }], strokeWidth: 3, strokeAlign: "inside" },
  { id: "line", type: "line", x: 130, y: 95, width: 60, height: 30, strokes: [{ color: "#000" }], strokeAlign: "center" },
  { id: "polygon", type: "polygon", pointCount: 5, x: 210, y: 95, width: 60, height: 50, fills: [{ color: "#eab308" }] },
  { id: "star", type: "star", pointCount: 5, innerRadius: 0.5, x: 300, y: 95, width: 60, height: 50, fills: [{ color: "#eab308" }] },
  { id: "path", type: "path", d: "M0 0H60V40H0Z", x: 390, y: 95, width: 60, height: 40, fills: [{ color: "#0f0" }] },
  { id: "part", type: "instance", component: "fixture-button", x: 12, y: 170, width: 120, height: 40,
    properties: { label: "Bound label" }, overrides: { caption: { fills: [{ color: "#fff" }] } } },
  { id: "flex", type: "frame", x: 12, y: 240, width: 220, height: 70,
    layout: { display: "flex", gap: "{space.gap}", alignItems: "center" },
    children: [
      { id: "flex-a", type: "rectangle", width: 50, height: 30 },
      { id: "flex-b", type: "rectangle", width: 60, height: 30 }
    ] },
  { id: "grid", type: "frame", x: 260, y: 240, width: 160, height: 70,
    layout: { display: "grid", gridTemplateColumns: "60px 80px", gap: 10 },
    children: [{ id: "grid-a", type: "rectangle", width: 60, height: 30 }, { id: "grid-b", type: "rectangle", width: 80, height: 30 }] },
  { id: "boolean", type: "boolean", operation: "subtract", x: 12, y: 340, width: 100, height: 60, fills: [{ color: "#c00" }],
    children: [{ id: "base", type: "rectangle", width: 100, height: 60 }, { id: "cut", type: "ellipse", x: 30, y: 10, width: 40, height: 40 }] }
];
const board = { apiVersion: "vellym.tasclub.com/v1", kind: "DesignBoard", metadata: { name: "fixture-board", title: "Fixture board" },
  spec: { canvas: "fixture-canvas", x: 20, y: 24, root: {
    id: "root", type: "frame", width: 560, height: 460, fills: [{ color: "#fff" }], children
  } } };

const test = base.extend({
  project: async ({ project }, use) => {
    await mkdir(path.join(project.content, "design/+boards"), { recursive: true });
    await mkdir(path.join(project.content, "design/+components"), { recursive: true });
    await mkdir(path.join(project.root, "assets"));
    await writeFile(path.join(project.root, "assets/pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6amAAAAAASUVORK5CYII=", "base64"));
    const write = (file: string, value: unknown) => writeFile(path.join(project.content, file), stringify(value));
    await write("design/fixture-canvas.yaml", {
      apiVersion: "vellym.tasclub.com/v1", kind: "DesignCanvas",
      metadata: { name: "fixture-canvas", title: "Fixture canvas" },
      spec: { formatVersion: 1, styles: "fixture-styles",
        tokens: { files: ["base.tokens.json"], resolver: "main.resolver.json" },
        fonts: [{ family: "Fixture font", source: "local", weights: [400, 700], path: "fonts/fixture/font.woff2" }] }
    });
    await write("design/+boards/fixture-board.yaml", board);
    await write("design/+components/fixture-button.yaml", {
      apiVersion: "vellym.tasclub.com/v1", kind: "DesignComponent", metadata: { name: "fixture-button", title: "Fixture button" },
      spec: { canvas: "fixture-canvas", properties: { label: { type: "text", default: "Default" } },
        root: { id: "button-root", type: "frame", width: 120, height: 40, styles: ["accent"],
          children: [{ id: "caption", type: "text", x: 4, y: 4, text: "Default", bind: { text: "label" }, fontSize: 14 }] } }
    });
    await write("design/fixture-styles.yaml", {
      apiVersion: "vellym.tasclub.com/v1", kind: "DesignStyles", metadata: { name: "fixture-styles", title: "Fixture styles" },
      spec: { styles: { accent: { fills: [{ color: "{color.accent}" }], radius: 6 } } }
    });
    const color = (components: number[]) => ({ $type: "color", $value: { colorSpace: "srgb", components } });
    await writeFile(path.join(project.content, "design/base.tokens.json"), JSON.stringify({
      color: { accent: color([0, 0.5, 0]) }, space: { gap: { $type: "dimension", $value: { value: 12, unit: "px" } } }
    }));
    await writeFile(path.join(project.content, "design/main.resolver.json"), JSON.stringify({
      version: "2025.10", sets: { base: { sources: [{ $ref: "base.tokens.json" }] } },
      modifiers: { theme: { default: "light", contexts: { light: [], dark: [{ color: { accent: color([0, 0, 1]) } }] } } },
      resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/theme" }]
    }));
    await use(project);
  }
});
test.use({ plugins: ["design"] });

test("board geometry, SVG, resolved styles and Shadow DOM isolation @DESIGN-A01", async ({ page, server }, testInfo) => {
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /Fixture canvas/ }).click();
  const host = page.getByTestId("design-board-fixture-board");
  await expect(host).toBeVisible();
  const node = (id: string) => host.getByTestId(`design-node-${id}`);
  await expect(node("caption")).toHaveText("Bound label");
  await expect(node("caption")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(node("rect")).toHaveCSS("border-radius", "6px");
  await expect(node("rect")).toHaveCSS("background-image", /color\(srgb 0 0.5 0\)/);
  await expect(node("flex")).toHaveCSS("gap", "12px");
  await expect.poll(() => node("image").locator("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(node("boolean").getByTestId("design-vector").locator("foreignObject")).toHaveCount(1);
  const expected = children.map(child => ({ id: child.id, x: child.x, y: child.y, width: child.width, height: child.height }));
  expected.push(
    { id: "flex-a", x: 12, y: 260, width: 50, height: 30 },
    { id: "flex-b", x: 74, y: 260, width: 60, height: 30 },
    { id: "grid-a", x: 260, y: 240, width: 60, height: 30 },
    { id: "grid-b", x: 330, y: 240, width: 80, height: 30 }
  );
  for (const item of expected) {
    const rect = await node(item.id).evaluate(element => {
      const origin = element.getRootNode() as ShadowRoot;
      const root = origin.querySelector('[data-node-id="root"]')!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { x: box.x - root.x, y: box.y - root.y, width: box.width, height: box.height };
    });
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(rect[key] - item[key]), `${item.id}.${key}`).toBeLessThanOrEqual(0.5);
  }
  const boardPlacement = await host.evaluate(element => {
    const box = element.getBoundingClientRect(), parent = element.parentElement!.getBoundingClientRect();
    return { x: box.x - parent.x, y: box.y - parent.y };
  });
  expect(boardPlacement).toEqual({ x: 20, y: 24 });
  for (const id of ["ellipse", "line", "polygon", "star", "path", "boolean"]) {
    await expect(node(id).getByTestId("design-vector").locator("path").first()).toHaveAttribute("d", /[ML]/);
  }
  const overlay = node("rect").getByTestId("design-stroke-overlay");
  await expect(overlay).toHaveCSS("position", "absolute");
  await expect(overlay).toHaveCSS("pointer-events", "none");
  await expect(overlay.locator("rect")).toHaveCount(2);
  await expect(overlay.locator("rect").first()).toHaveAttribute("stroke-dasharray", "8 3");
  expect(await host.evaluate(element => element.shadowRoot!.querySelector("style")!.textContent))
    .toContain('@font-face{font-family:"Fixture font";src:url("/api/v1/assets?path=fonts%2Ffixture%2Ffont.woff2");font-weight:700');
  const before = await node("rect").boundingBox();
  await page.addStyleTag({ content: "div { padding: 17px !important; border: 9px solid pink !important; font-size: 80px !important; } span { color: red !important; }" });
  await expect(node("rect")).toHaveCSS("padding", "0px");
  await expect(node("rect")).toHaveCSS("border-width", "0px");
  await expect(node("caption")).toHaveCSS("color", "rgb(255, 255, 255)");
  const after = await node("rect").boundingBox();
  expect(after!.width).toEqual(before!.width);
  expect(after!.height).toEqual(before!.height);
  await page.getByTestId("design-mode-theme").selectOption("dark");
  await expect(node("rect")).toHaveCSS("background-image", /color\(srgb 0 0 1\)/);
  await page.getByTestId("design-mode-theme").selectOption("");
  await expect(node("rect")).toHaveCSS("background-image", /color\(srgb 0 0.5 0\)/);
  // The injected test CSS also moves the host UI, so remove it before recording the screen.
  await page.evaluate(() => { for (const style of document.querySelectorAll("style")) if (style.textContent?.includes("solid pink")) style.remove(); });
  await testInfo.attach("board", { body: await host.screenshot(), contentType: "image/png" });
  await page.reload();
  await expect(page.getByTestId("design-board-fixture-board").getByTestId("design-node-caption")).toHaveText("Bound label");
});

test("board hashes and shared dependencies update without reopening @DESIGN-A01", async ({ page, project, server }) => {
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /Fixture canvas/ }).click();
  const rect = page.getByTestId("design-board-fixture-board").getByTestId("design-node-rect");
  await expect(rect).toHaveCSS("width", "100px");
  const next = structuredClone(board);
  next.spec.root.children[0]!.width = 105;
  await writeFile(path.join(project.content, "design/+boards/fixture-board.yaml"), stringify(next));
  await expect(rect).toHaveCSS("width", "105px");
  // No resolver: respect the canvas's source order, not filesystem sort order.
  const canvasFile = path.join(project.content, "design/fixture-canvas.yaml");
  const canvas = parse(await readFile(canvasFile, "utf8"));
  canvas.spec.tokens = { files: ["z.tokens.json", "a.tokens.json"] };
  const token = (value: number) => ({ space: { gap: { $type: "dimension", $value: { value, unit: "px" } } } });
  await writeFile(path.join(project.content, "design/z.tokens.json"), JSON.stringify(token(7)));
  await writeFile(path.join(project.content, "design/a.tokens.json"), JSON.stringify({
    ...token(19), color: { accent: { $type: "color", $value: { colorSpace: "srgb", components: [1, 0, 0] } } }
  }));
  await writeFile(canvasFile, stringify(canvas));
  await expect(page.getByTestId("design-node-flex")).toHaveCSS("gap", "19px");
  await expect(rect).toHaveCSS("background-image", /color\(srgb 1 0 0\)/);
  const componentFile = path.join(project.content, "design/+components/fixture-button.yaml");
  const component = parse(await readFile(componentFile, "utf8"));
  component.spec.root.children[0].fontSize = 22;
  await writeFile(componentFile, stringify(component));
  await expect(page.getByTestId("design-node-caption")).toHaveCSS("font-size", "22px");
});
