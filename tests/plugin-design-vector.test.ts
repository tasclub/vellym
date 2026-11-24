import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import paper from "paper";
import { vectorPath } from "../packages/plugin-design/src/render/vector.js";
import { createBooleanPathRenderer, type BooleanChild, type BooleanOperation } from "../packages/plugin-design/src/render/boolean.js";

declare global {
  interface Window {
    vectorModule: typeof import("../packages/plugin-design/src/render/boolean.js");
  }
}

describe("vector paths in local SVG coordinates", () => {
  it("uses two arcs for a closed ellipse, and preserves the diagonal of a line", () => {
    expect(vectorPath({ id: "e", type: "ellipse", x: 99, width: 100, height: 40 })).toEqual({
      d: "M100 20A50 20 0 1 1 0 20A50 20 0 1 1 100 20Z", fillRule: "nonzero"
    });
    expect(vectorPath({ id: "l", type: "line", width: 100, height: 40 }).d).toBe("M0 0L100 40");
    expect(vectorPath({ id: "e", type: "ellipse", width: 0, height: 40 }).d).toBe("");
  });

  it("creates polygons and alternating outer/inner star vertices", () => {
    expect(vectorPath({ id: "p", type: "polygon", width: 100, height: 60, pointCount: 4 }).d)
      .toBe("M50 0L100 30L50 60L0 30Z");
    expect(vectorPath({ id: "s", type: "star", width: 100, height: 100, pointCount: 4, innerRadius: 0.5 }).d)
      .toBe("M50 0L67.6776695297 32.3223304703L100 50L67.6776695297 67.6776695297L50 100L32.3223304703 67.6776695297L0 50L32.3223304703 32.3223304703Z");
    for (const count of [3, 5, 8]) {
      expect(vectorPath({ id: "p", type: "polygon", pointCount: count, width: 50, height: 50 }).d.match(/L/g)).toHaveLength(count - 1);
      expect(vectorPath({ id: "s", type: "star", pointCount: count, innerRadius: 0.4, width: 50, height: 50 }).d.match(/L/g)).toHaveLength(count * 2 - 1);
    }
  });

  it("retains SVG d and fill rule without rewriting curves or holes", () => {
    const d = "M0 0C20 0 20 20 0 20Z M5 5h5v5h-5z";
    expect(vectorPath({ id: "p", type: "path", d, fillRule: "evenodd" })).toEqual({ d, fillRule: "evenodd" });
    expect(vectorPath({ id: "p", type: "path", d }).fillRule).toBe("nonzero");
  });

  it("rejects invalid geometry instead of producing NaN paths", () => {
    expect(() => vectorPath({ id: "e", type: "ellipse", width: Infinity })).toThrow(RangeError);
    expect(() => vectorPath({ id: "p", type: "polygon", pointCount: 2 })).toThrow(RangeError);
    expect(() => vectorPath({ id: "s", type: "star", pointCount: 4, innerRadius: -1 })).toThrow(RangeError);
  });

  it("can be imported on the server but never loads paper for server calculations", async () => {
    const renderer = createBooleanPathRenderer();
    await expect(renderer.render("a", "union", [{ d: "M0 0H10V10H0Z" }])).rejects.toThrow("only available in the browser");
  });
});

describe("browser-only paper boolean geometry and cache", () => {
  let server: Server, browser: Browser, page: Page, base: string;
  const requests: string[] = [];
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const file = req.url?.slice(1) ?? "";
      if (!file) {
        res.end('<!doctype html><title>Vector test</title><script type="module">import * as mod from "/boolean.js"; window.vectorModule = mod;</script>');
        return;
      }
      if (!/^[\w-]+\.js$/.test(file)) { res.writeHead(404).end(); return; }
      try {
        requests.push(file);
        const source = await readFile(new URL(`../packages/plugin-design/dist/browser/render/${file}`, import.meta.url));
        res.setHeader("Content-Type", "text/javascript");
        res.end(source);
      } catch { res.writeHead(404).end(); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(base);
    await page.waitForFunction(() => !!window.vectorModule);
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
  });

  function area(d: string): number {
    const scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
    try { return Math.abs(new scope.CompoundPath({ pathData: d, insert: false }).area); }
    finally { scope.remove(); }
  }
  async function render(operation: BooleanOperation, children: BooleanChild[]): Promise<string> {
    return page.evaluate(async ({ operation, children }) => {
      const { createBooleanPathRenderer } = window.vectorModule;
      return createBooleanPathRenderer().render("board/node", operation, children);
    }, { operation, children });
  }

  it("ships a lazy browser chunk: importing the renderer does not request paper", async () => {
    expect(await page.evaluate(() => !!window.vectorModule)).toBe(true);
    expect(requests.some(path => path.startsWith("paper-"))).toBe(false);
  });

  it("calculates the four areas of two overlapping rectangles", async () => {
    const children = [{ d: "M0 0H10V10H0Z" }, { d: "M5 0H15V10H5Z" }];
    for (const [operation, expected] of [["union", 150], ["subtract", 50], ["intersect", 50], ["exclude", 100]] as const) {
      expect(area(await render(operation, children))).toBeCloseTo(expected, 6);
    }
    expect(requests.some(path => path.startsWith("paper-"))).toBe(true);
  });

  it("handles disjoint, empty, nested compound and curved geometry with child transforms", async () => {
    expect(await render("union", [])).toBe("");
    expect(area(await render("intersect", [{ d: "M0 0H10V10H0Z" }, { d: "M20 0H30V10H20Z" }]))).toBe(0);
    expect(area(await render("subtract", [{ d: "M0 0H20V20H0Z" }, { d: "M5 5H15V15H5Z" }]))).toBe(300);
    expect(area(await render("intersect", [
      { d: "M0 0H20V20H0Z M5 5H15V15H5Z", fillRule: "evenodd" },
      { d: "M0 0H20V20H0Z" }
    ]))).toBe(300);
    expect(area(await render("intersect", [
      { d: "M0 0H10V10H0Z" },
      { d: "M0 0H10V10H0Z", transform: [1, 0, 0, 1, 5, 0] }
    ]))).toBeCloseTo(50, 6);
    const ellipse = vectorPath({ id: "e", type: "ellipse", width: 100, height: 40 });
    const curved = await render("union", [ellipse, ellipse]);
    expect(curved).toMatch(/[cC]/);
    // Paper represents SVG arcs as cubic Beziers; union must retain the curve.
    expect(area(curved)).toBeCloseTo(area(ellipse.d), 3);
    expect(Math.abs(area(curved) / (Math.PI * 50 * 20) - 1)).toBeLessThan(0.001);
  });

  it("deduplicates concurrent and unchanged work, invalidates geometry/operation/rule/matrix, and clears deleted nodes", async () => {
    const result = await page.evaluate(async () => {
      const { createBooleanPathRenderer } = window.vectorModule;
      const renderer = createBooleanPathRenderer();
      const children = [{ d: "M0 0H10V10H0Z" }, { d: "M5 0H15V10H5Z" }];
      const first = renderer.render("a", "union", children);
      const same = first === renderer.render("a", "union", structuredClone(children));
      const otherId = first !== renderer.render("b", "union", children);
      await first;
      const settled = first === renderer.render("a", "union", children);
      const operation = first !== renderer.render("a", "subtract", children);
      const changed = renderer.render("a", "union", children);
      children[1]!.d = "M20 0H30V10H20Z";
      const mutated = renderer.render("a", "union", children);
      const snapshotAreaPath = await changed;
      const newPath = await mutated;
      const rule = mutated !== renderer.render("a", "union", [{ ...children[0]!, fillRule: "evenodd" }, children[1]!]);
      const matrix = mutated !== renderer.render("a", "union", [{ ...children[0]!, transform: [1, 0, 0, 1, 1, 0] }, children[1]!]);
      renderer.clear("a");
      const cleared = mutated !== renderer.render("a", "union", children);
      renderer.clear();
      const allCleared = first !== renderer.render("b", "union", children);
      return { same, otherId, settled, operation, rule, matrix, cleared, allCleared, snapshotAreaPath, newPath };
    });
    expect(result).toMatchObject({ same: true, otherId: true, settled: true, operation: true, rule: true, matrix: true, cleared: true, allCleared: true });
    expect(area(result.snapshotAreaPath)).toBe(150);
    expect(area(result.newPath)).toBe(200);
  });
});
