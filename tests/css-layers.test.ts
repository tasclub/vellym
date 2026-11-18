import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Cascade layer order is fixed by the first @layer a page sees. Vite emits the shared parts'
// CSS (which opens with @layer components) before the main stylesheet, so index.html must
// declare the order before any stylesheet; otherwise components rank below elements and reset.
describe("cascade layer order", () => {
  it("is declared in index.html before any stylesheet and matches styles.css", () => {
    const html = readFileSync("packages/ui-react/index.html", "utf8");
    const declared = html.match(/<style>\s*@layer ([^;]+);\s*<\/style>/);
    expect(declared, "index.html declares the layer order").toBeTruthy();
    const firstStylesheet = html.search(/<link[^>]+stylesheet/);
    if (firstStylesheet >= 0) expect(html.indexOf(declared![0])).toBeLessThan(firstStylesheet);
    const styles = readFileSync("packages/ui-react/src/styles.css", "utf8").match(/^@layer ([^;{]+);/m);
    expect(declared![1]!.replace(/\s+/g, " ").trim()).toBe(styles![1]!.replace(/\s+/g, " ").trim());
  });
});
