import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheets = [
  { id: "tickets", file: "packages/plugin-tickets/src/tickets-settings.css" },
  { id: "kanban", file: "packages/plugin-kanban/src/kanban.css" },
  { id: "wbs", file: "packages/plugin-wbs/src/wbs.css" }
];

describe("plugin stylesheet isolation", () => {
  for (const { id, file } of stylesheets) {
    it(`${file} scopes every selector to the ${id} plugin and leaves host tokens alone`, () => {
      const source = readFileSync(file, "utf8");
      const selectors = source
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("."));
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) {
        for (const part of selector.split(",").filter(Boolean)) {
          expect(part.trim()).toMatch(new RegExp(`^\\.${id}-[a-z0-9_-]+`));
        }
      }
      expect(source).not.toMatch(/--[\w-]+\s*:/);
    });
  }
});
