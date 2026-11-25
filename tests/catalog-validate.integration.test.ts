import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadPlugins, pluginResourceTemplates } from "../packages/runtime-node/src/plugins.js";

// Moved from catalog.test.ts: runs the built CLI against every plugin template.
describe("catalog templates through the CLI", () => {
  it("validates every localized ticket management template at zero diagnostics", async () => {
    const registry = await loadPlugins({ configDir: process.cwd(), packageNames: ["@vellym/tickets"], hostVersion: "0.5.0-beta" });
    const templates = pluginResourceTemplates(registry.plugins);
    expect(templates).toHaveLength(8);
    const root = mkdtempSync(path.join(tmpdir(), "vellym-catalog-"));
    try {
      symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
      writeFileSync(path.join(root, "vellym.config.yaml"), 'schemaVersion: "1.0"\ncontentRoot: .\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nstatic:\n  publicBaseUrl: https://example.com/\nplugins: ["@vellym/tickets", "@vellym/kanban", "@vellym/wbs"]\n');
      for (const template of templates) for (const locale of ["ja", "en"] as const) {
        const spec = template.spec[locale];
        writeFileSync(path.join(root, "tracker.yaml"), JSON.stringify({ apiVersion: "vellym.tasclub.com/v1", kind: "TicketTracker", metadata: { name: "tracker", title: "Tracker" }, spec }));
        const result = spawnSync(process.execPath, [path.resolve("packages/vellym/dist/cli.mjs"), "validate", "--config", path.join(root, "vellym.config.yaml"), "--json"], { encoding: "utf8" });
        expect(result.status, result.stderr + result.stdout).toBe(0);
        expect(JSON.parse(result.stdout).diagnostics, `${template.id} ${locale}`).toEqual([]);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
