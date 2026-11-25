import { describe, expect, it, vi } from "vitest";
import { open } from "node:fs/promises";
import { appendGuideSection, vellymGuide } from "../packages/runtime-node/src/vellym-guide.js";
import { loadCatalog } from "../packages/runtime-node/src/catalog/load.js";
import type { FolderDef } from "../packages/runtime-node/src/catalog/types.js";

const defaults = { structure: "by-type", numbered: false, folderNames: {}, version: "1.0" };

vi.mock("node:fs/promises", () => ({ open: vi.fn() }));

describe("vellym guide", () => {
  it("uses the content root and omits unselected plugins", () => {
    const guide = vellymGuide({ ...defaults, language: "ja", contentRoot: "content", plugins: [] });
    expect(guide).toContain("content/VELLYM.md");
    expect(guide).not.toContain("docs/");
    expect(guide).not.toContain("## 5. プラグイン");
    expect(guide).toContain("validate --strict --json");
  });
  it("localizes and describes only selected plugins", () => {
    const guide = vellymGuide({ ...defaults, language: "en", contentRoot: "content", plugins: [{ id: "tickets", name: "@vellym/tickets", guideUrl: { en: "https://example.com" } }], sections: [{ id: "tickets", title: "Tickets", body: "Use +tickets/." }] });
    expect(guide).not.toContain("## 要点");
    expect(guide).toContain("+tickets/");
    expect(guide).toContain("<!-- vellym:guide:tickets -->\n### Tickets\n\nUse +tickets/.");
    expect(guide).not.toContain("spec.kanban");
    expect(guide).toContain("https://example.com");
  });

  for (const structure of ["by-type", "by-phase", "by-feature"]) {
    for (const language of ["ja", "en"] as const) {
      for (const withPlugins of [false, true]) {
        it(`generates ${structure}/${language}/plugins=${withPlugins}`, () => {
          const guide = vellymGuide({
            ...defaults, structure, language,
            plugins: withPlugins ? [{ id: "kanban", name: "@vellym/kanban" }] : []
          });
          for (const heading of language === "ja"
            ? ["1. 文書の地図", "2. 作業の流れ", "3. 決まり", "4. AIの手順"]
            : ["1. Document map", "2. Workflow", "3. Rules", "4. AI procedure"]) {
            expect(guide).toContain(`## ${heading}`);
          }
          const visit = (folders: FolderDef[], parent = ""): void => {
            for (const folder of folders) {
              const directory = `${parent}${folder.name[language]}/`;
              expect(guide).toContain(`- \`${directory}\`: ${folder.description[language]}`);
              if (folder.children) visit(folder.children, directory);
            }
          };
          visit(loadCatalog().structures.find(item => item.id === structure)!.folders);
          expect(guide.includes(language === "ja" ? "## 5. プラグイン" : "## 5. Plugins")).toBe(withPlugins);
          expect(guide).not.toContain("spec.kanban");
          expect(guide).not.toContain("spec.wbs");
          expect(guide).toContain("npx vellym schema --kind <kind>");
          expect(guide).toContain("npx vellym list --kind <kind>");
          expect(guide).toContain("validate --strict --json");
          expect(guide).toContain("AGENTS.md");
          expect(guide).toContain("metadata.name");
        });
      }
    }
  }

  it("uses numbering and customized folder names throughout nested paths", () => {
    const guide = vellymGuide({ ...defaults, language: "en", numbered: true, folderNames: { architecture: "System" }, plugins: [] });
    expect(guide).toContain("`00_overview/`");
    expect(guide).toContain("`System/00_decisions/`");
    expect(guide).not.toContain("03_architecture/");
  });

  it("includes the user-facing supplement descriptions", () => {
    const guide = vellymGuide({ ...defaults, structure: "guide", language: "en", plugins: [] });
    expect(guide).toContain("`guide/how-to/`");
    expect(guide).toContain("Procedures for achieving specific goals.");
  });

  it("rejects an unknown structure", () => {
    expect(() => vellymGuide({ ...defaults, structure: "missing", language: "en", plugins: [] })).toThrow("Unknown guide structure");
  });

  it("appends each marked section once while preserving every existing byte", async () => {
      const original = Buffer.from("\uFEFF# My guide\r\n\r\nUser changes 日本語  ");
      let bytes = original;
      const handle = {
        readFile: vi.fn(async () => bytes),
        writeFile: vi.fn(async (suffix: Buffer) => { bytes = Buffer.concat([bytes, suffix]); }),
        close: vi.fn(async () => {})
      };
      vi.mocked(open).mockResolvedValue(handle as unknown as Awaited<ReturnType<typeof open>>);
      await appendGuideSection("VELLYM.md", { id: "decision", title: "Decisions", body: "Use records." });
      expect(open).toHaveBeenLastCalledWith("VELLYM.md", "r+");
      const first = bytes;
      expect(first.subarray(0, original.length)).toEqual(original);
      expect(first.subarray(original.length).toString()).toBe("\n\n<!-- vellym:guide:decision -->\n## Decisions\n\nUse records.\n");
      await appendGuideSection("VELLYM.md", { id: "decision", title: "Changed", body: "Do not overwrite." });
      expect(bytes).toEqual(first);
      expect(handle.writeFile).toHaveBeenCalledTimes(1);
      await appendGuideSection("VELLYM.md", { id: "other", title: "Other", body: "Another section." });
      const second = bytes;
      expect(second.subarray(0, first.length)).toEqual(first);
      expect(second.toString()).toContain("<!-- vellym:guide:other -->");
      expect(handle.close).toHaveBeenCalledTimes(3);
      vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
      await appendGuideSection("missing.md", { id: "decision", title: "Decisions", body: "Use records." });
      expect(handle.writeFile).toHaveBeenCalledTimes(2);
  });

  it("appends to an empty guide and propagates non-missing-file errors", async () => {
    const handle = {
      readFile: vi.fn(async () => Buffer.alloc(0)),
      writeFile: vi.fn(async (_suffix: Buffer) => {}),
      close: vi.fn(async () => {})
    };
    vi.mocked(open).mockResolvedValue(handle as unknown as Awaited<ReturnType<typeof open>>);
    await appendGuideSection("VELLYM.md", { id: "x", title: "X", body: "Body" });
    expect(handle.writeFile.mock.calls[0]?.[0]?.toString()).toContain("<!-- vellym:guide:x -->");
    vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EACCES" }));
    await expect(appendGuideSection("denied.md", { id: "x", title: "X", body: "Body" })).rejects.toThrow("denied");
    handle.writeFile.mockRejectedValueOnce(new Error("write failed"));
    await expect(appendGuideSection("VELLYM.md", { id: "x", title: "X", body: "Body" })).rejects.toThrow("write failed");
    expect(handle.close).toHaveBeenCalledTimes(2);
  });
});
