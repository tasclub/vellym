import { readFileSync } from "node:fs";
import path from "node:path";
import semver from "semver";
import { describe, expect, it } from "vitest";

const manifestOf = (directory: string) => JSON.parse(readFileSync(
  path.join(process.cwd(), "packages", directory, "package.json"), "utf8"
)) as { name: string; version: string; private?: boolean; engines?: { vellym?: string }; peerDependencies?: Record<string, string> };
// Private packages are not released (design is kept out of 0.5.0-beta).
const pluginPackages = ["plugin-tickets", "plugin-kanban", "plugin-wbs", "plugin-design"].filter((directory) => !manifestOf(directory).private);

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

  it("release verification covers Kanban, WBS, design, and their private shared engine", () => {
    const source = readFileSync("scripts/verify-release.mjs", "utf8");
    expect(source).toContain('kanban: "packages/plugin-kanban"');
    expect(source).toContain('wbs: "packages/plugin-wbs"');
    expect(source).toContain('design: "packages/plugin-design"');
    expect(source).toContain('ticketEngine: "packages/ticket-engine"');
  });

  it("publishes the Kanban plugin after plugin-api without publishing the private engine", () => {
    const workflow = readFileSync(".github/workflows/publish.yml", "utf8");
    const api = workflow.indexOf("working-directory: packages/plugin-api");
    const kanban = workflow.indexOf("working-directory: packages/plugin-kanban");
    const tickets = workflow.indexOf("working-directory: packages/plugin-tickets");
    expect(api).toBeGreaterThanOrEqual(0);
    expect(kanban).toBeGreaterThan(api);
    expect(tickets).toBeGreaterThan(kanban);
    expect(workflow).not.toContain("working-directory: packages/ticket-engine");
  });

  it("publishes WBS after plugin-api and before vellym, and never the private design plugin", () => {
    const workflow = readFileSync(".github/workflows/publish.yml", "utf8");
    const api = workflow.indexOf("working-directory: packages/plugin-api");
    const wbs = workflow.indexOf("working-directory: packages/plugin-wbs");
    const vellym = workflow.indexOf("working-directory: packages/vellym");
    expect(wbs).toBeGreaterThan(api);
    expect(vellym).toBeGreaterThan(wbs);
    expect(manifestOf("plugin-design").private).toBe(true);
    expect(workflow).not.toContain("working-directory: packages/plugin-design");
  });

  it("requires the released plugin-api version from every public plugin", () => {
    const api = manifestOf("plugin-api").version;
    expect(api).toBe("0.2.0-beta");
    for (const directory of pluginPackages) {
      expect(semver.satisfies(api, manifestOf(directory).peerDependencies?.["@vellym/plugin-api"] ?? "")).toBe(true);
      expect(semver.satisfies("0.1.0-beta", manifestOf(directory).peerDependencies?.["@vellym/plugin-api"] ?? "")).toBe(false);
    }
  });

  it("documents the private ticket engine as bundled into public plugins", () => {
    const architecture = readFileSync("ARCHITECTURE.md", "utf8");
    expect(architecture).toContain("@vellym-internal/ticket-engine` | no");
    expect(architecture).toContain("bundled into ticket plugins");
  });
});
