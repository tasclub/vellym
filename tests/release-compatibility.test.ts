import { readFileSync } from "node:fs";
import path from "node:path";
import semver from "semver";
import { describe, expect, it } from "vitest";

const pluginPackages = ["plugin-tickets", "plugin-kanban", "plugin-wbs"];

describe("public plugin host compatibility", () => {
  for (const directory of pluginPackages) {
    it(`${directory} excludes the already-published host and accepts the API release`, () => {
      const manifest = JSON.parse(readFileSync(
        path.join(process.cwd(), "packages", directory, "package.json"),
        "utf8"
      )) as { engines?: { vellym?: string } };
      const range = manifest.engines?.vellym ?? "";
      expect(semver.validRange(range)).not.toBeNull();
      expect(semver.satisfies("0.4.0-beta", range)).toBe(false);
      expect(semver.satisfies("0.5.0-beta", range)).toBe(true);
    });
  }

  it("release verification covers Kanban, WBS, and their private shared engine", () => {
    const source = readFileSync("scripts/verify-release.mjs", "utf8");
    expect(source).toContain('kanban: "packages/plugin-kanban"');
    expect(source).toContain('wbs: "packages/plugin-wbs"');
    expect(source).toContain('ticketEngine: "packages/ticket-engine"');
  });
});
