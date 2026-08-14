import { describe, expect, it } from "vitest";
import {
  SETUP_PACK,
  SetupPackError,
  setupChildFolders,
  setupChildPages,
  setupFolder,
  setupFolderChain,
  setupFolders,
  setupNodeArea,
  setupNodeOrder,
  setupPackLocale,
  setupPackManifest,
  setupPage,
  setupPageAncestors,
  setupPages,
  validateSetupPack,
  type SetupLocaleBundle,
  type SetupPackLocale,
  type SetupPackManifest
} from "@vellym-internal/runtime-node";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pack(): SetupPackManifest {
  return clone(setupPackManifest());
}

function locales(): Record<SetupPackLocale, SetupLocaleBundle> {
  return {
    ja: clone(setupPackLocale("ja")),
    en: clone(setupPackLocale("en"))
  };
}

function expectRejected(
  mutate: (
    manifest: SetupPackManifest,
    bundles: Record<SetupPackLocale, SetupLocaleBundle>
  ) => void
): void {
  const manifest = pack();
  const bundles = locales();
  mutate(manifest, bundles);
  expect(() => validateSetupPack(manifest, bundles)).toThrow(SetupPackError);
}

describe("built-in setup pack v2", () => {
  it("keeps the pack id and raises the hierarchy contract to 2.0.0", () => {
    expect(SETUP_PACK.id).toBe("vellym-core-project-structure");
    expect(SETUP_PACK.version).toBe("2.0.0");
    expect(SETUP_PACK.schemaVersion).toBe("2.0");
  });

  it("loads and validates the built-in pack", () => {
    expect(() => validateSetupPack(pack(), locales())).not.toThrow();
    expect(setupFolders().length).toBeGreaterThan(30);
    expect(setupPages().length).toBeGreaterThan(100);
  });

  it("defines the ten information areas as root folders", () => {
    const roots = setupChildFolders(undefined);
    expect(roots.map((folder) => folder.areaId)).toEqual([
      "project-overview",
      "project-management",
      "requirements",
      "architecture",
      "design",
      "implementation",
      "quality",
      "release",
      "operations",
      "closure"
    ]);
    expect(roots.every((folder) => folder.parentId === undefined)).toBe(true);
  });

  it("places arc42, ADR, and C4 inside the architecture area rather than at the root", () => {
    for (const id of ["arc-arc42", "arc-adr", "arc-models"]) {
      expect(setupFolder(id)?.parentId).toBe("area-architecture");
      expect(setupNodeArea(id)).toBe("architecture");
    }
    expect(setupChildPages("arc-arc42")).toHaveLength(12);
    expect(setupChildPages("arc-adr").map((page) => page.id)).toEqual(["decision-log"]);
  });

  it("resolves a three level ancestor chain for a nested page", () => {
    expect(setupPageAncestors("arc42-context").map((folder) => folder.id)).toEqual([
      "area-architecture",
      "arc-arc42"
    ]);
    expect(setupFolderChain("arc-arc42").map((folder) => folder.id)).toEqual([
      "area-architecture",
      "arc-arc42"
    ]);
  });

  it("keeps repository-root guide pages outside the area folders", () => {
    const rootPages = setupChildPages(undefined).map((page) => page.id);
    expect(rootPages).toContain("project-guide");
    expect(setupPage("project-guide")?.parentFolderId).toBeUndefined();
    expect(setupNodeArea("project-guide")).toBeUndefined();
  });

  it("keeps template ids that carried the same meaning in v1", () => {
    for (const id of [
      "project-charter",
      "requirements",
      "decision-log",
      "roadmap",
      "risk-register",
      "current-position",
      "arc42-context",
      "arc42-strategy",
      "arc42-building-blocks",
      "arc42-runtime",
      "stakeholders",
      "scope",
      "schedule",
      "development-policy",
      "test-plan",
      "release-plan",
      "migration-plan",
      "operations-guide",
      "handover",
      "retrospective",
      "user-problem"
    ]) {
      expect(setupPage(id), id).toBeDefined();
    }
  });

  it("provides ja and en text plus a reference model for every node", () => {
    const ja = setupPackLocale("ja");
    const en = setupPackLocale("en");
    for (const folder of setupFolders()) {
      expect(ja.folders[folder.id]?.defaultName, folder.id).toBeTruthy();
      expect(en.folders[folder.id]?.defaultName, folder.id).toBeTruthy();
    }
    // The en names are ASCII paths; only proper nouns such as arc42 stay identical.
    expect(ja.folders["area-requirements"]?.defaultName).toBe("02_要求・要件");
    expect(en.folders["area-requirements"]?.defaultName).toBe("02_requirements");
    for (const page of setupPages()) {
      expect(ja.pages[page.id]?.defaultFileName.endsWith(".yaml"), page.id).toBe(true);
      expect(en.pages[page.id]?.defaultFileName.endsWith(".yaml"), page.id).toBe(true);
    }
    expect(setupFolder("arc-arc42")?.referenceModels).toContain("arc42");
    expect(setupPage("security-requirements")?.referenceModels).toContain("security");
    expect(setupPage("c4-context")?.referenceModels).toContain("c4-model");
  });

  it("orders nodes parent-first and by sibling order", () => {
    const order = setupNodeOrder();
    const index = (id: string): number => order.indexOf(id);
    expect(index("area-architecture")).toBeLessThan(index("arc-arc42"));
    expect(index("arc-arc42")).toBeLessThan(index("arc42-context"));
    expect(index("arc42-introduction")).toBeLessThan(index("arc42-context"));
    expect(index("area-project-overview")).toBeLessThan(index("area-closure"));
    expect(new Set(order).size).toBe(order.length);
  });

  it("rejects an unknown schema version", () => {
    expectRejected((manifest) => {
      manifest.schemaVersion = "3.0";
    });
  });

  it("rejects duplicate node ids across folders and pages", () => {
    expectRejected((manifest) => {
      manifest.pages[0]!.id = manifest.folders[0]!.id;
    });
  });

  it("rejects an orphan folder and an orphan page", () => {
    expectRejected((manifest) => {
      manifest.folders[1]!.parentId = "missing-folder";
    });
    expectRejected((manifest) => {
      manifest.pages.find((page) => page.parentFolderId)!.parentFolderId = "missing-folder";
    });
  });

  it("rejects a cycle in the folder tree", () => {
    expectRejected((manifest) => {
      const parent = manifest.folders.find((folder) => folder.parentId)!;
      manifest.folders.find((folder) => folder.id === parent.parentId)!.parentId = parent.id;
    });
  });

  it("rejects duplicate order within one parent", () => {
    expectRejected((manifest) => {
      const siblings = manifest.folders.filter((folder) => folder.parentId === "area-architecture");
      siblings[1]!.order = siblings[0]!.order;
    });
    expectRejected((manifest) => {
      const siblings = manifest.pages.filter((page) => page.parentFolderId === "arc-arc42");
      siblings[1]!.order = siblings[0]!.order;
    });
  });

  it("rejects an unknown information area", () => {
    expectRejected((manifest) => {
      manifest.folders[0]!.areaId = "unknown-area";
    });
  });

  it("rejects an unknown dependency", () => {
    expectRejected((manifest) => {
      manifest.pages[0]!.dependencies = ["missing-template"];
    });
  });

  it("rejects a dependency cycle", () => {
    expectRejected((manifest) => {
      const a = manifest.pages[0]!;
      const b = manifest.pages[1]!;
      a.dependencies = [b.id];
      b.dependencies = [a.id];
    });
  });

  it("rejects missing localized text", () => {
    expectRejected((manifest, bundles) => {
      delete bundles.en.pages[manifest.pages[0]!.id];
    });
    expectRejected((manifest, bundles) => {
      delete bundles.ja.folders[manifest.folders[0]!.id];
    });
  });

  it("rejects colliding names within one parent", () => {
    expectRejected((manifest, bundles) => {
      const siblings = manifest.pages.filter((page) => page.parentFolderId === "arc-arc42");
      bundles.ja.pages[siblings[1]!.id]!.defaultFileName =
        bundles.ja.pages[siblings[0]!.id]!.defaultFileName;
    });
  });
});
