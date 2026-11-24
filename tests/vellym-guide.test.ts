import { describe, expect, it } from "vitest";
import { vellymGuide } from "../packages/vellym/src/vellym-guide.js";

describe("vellym guide", () => {
  it("uses the content root and omits unselected plugins", () => {
    const guide = vellymGuide({ language: "ja", contentRoot: "content", plugins: [], version: "1.0" });
    expect(guide).toContain("content/VELLYM.md");
    expect(guide).not.toContain("docs/");
    expect(guide).not.toContain("## プラグイン");
    expect(guide).toContain("validate --strict --json");
  });
  it("localizes and describes only selected plugins", () => {
    const guide = vellymGuide({ language: "en", contentRoot: "content", plugins: [{ id: "tickets", name: "@vellym/tickets", guideUrl: { en: "https://example.com" } }], version: "1.0" });
    expect(guide).not.toContain("## 要点");
    expect(guide).toContain("+tickets/");
    expect(guide).not.toContain("spec.kanban");
    expect(guide).toContain("https://example.com");
  });
});
