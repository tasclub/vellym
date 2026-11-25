import { describe, expect, it } from "vitest";
import { validatePluginManifest } from "@vellym-internal/core";
import { loadPlugins, pluginGuideSections } from "../packages/runtime-node/src/plugins.js";

describe("plugin guide contributions", () => {
  it("loads localized guides from enabled packages and reports missing files", async () => {
    const registry = await loadPlugins({ configDir: process.cwd(), packageNames: ["@vellym/tickets", "@vellym/kanban", "@vellym/wbs", "@vellym/design"], hostVersion: "0.5.0-beta" });
    expect(registry.plugins).toHaveLength(4);
    for (const language of ["ja", "en"] as const) {
      const sections = pluginGuideSections(registry.plugins, language, registry.diagnostics);
      expect(sections.map(section => section.id)).toEqual(["tickets", "kanban", "wbs", "design"]);
      expect(sections[0]!.body).toContain("+tickets/");
      expect(sections[3]!.title).toBe(language === "ja" ? "デザインキャンバス" : "Design canvas");
    }
    const plugin = registry.plugins[0]!;
    const guide = plugin.manifest.contributes!.guide!;
    const diagnostics: typeof registry.diagnostics = [];
    const missing = { ...plugin, manifest: { ...plugin.manifest, contributes: { guide: { ...guide, file: { ...guide.file, en: "guide/missing.md" } } } } };
    expect(pluginGuideSections([missing], "en", diagnostics)).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    const invalid = { ...guide, file: { ...guide.file, en: "../outside.md" } };
    expect(validatePluginManifest({ id: "example", contributes: { guide: invalid } }).manifest).toBeUndefined();
    expect(pluginGuideSections([{ ...missing, manifest: { ...missing.manifest, contributes: { guide: invalid } } }], "en", diagnostics)).toEqual([]);
    expect(diagnostics).toHaveLength(2);
  });
});
