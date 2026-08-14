import { describe, expect, it } from "vitest";
import {
  recommendSetupNodes,
  resolveSetupSelection,
  setupChildFolders,
  setupChildPages,
  setupFolder,
  setupPage,
  setupPackLocale,
  setupPreviewTree,
  setupReasonText,
  setupSelectionSummary,
  type DevelopmentMethod,
  type DocumentationLevel,
  type ProjectSize,
  type SetupNodeSelection,
  type SetupPreviewNode
} from "@vellym-internal/runtime-node";

function recommend(
  size: ProjectSize,
  method: DevelopmentMethod,
  level: DocumentationLevel
): SetupNodeSelection {
  return recommendSetupNodes({ size, method, level });
}

function flatten(nodes: SetupPreviewNode[]): SetupPreviewNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe("hierarchical setup selection", () => {
  it("returns the same nodes, order, and reasons for the same input", () => {
    const first = recommend("small-team", "hybrid", "standard");
    const second = recommend("small-team", "hybrid", "standard");
    expect(second.nodeIds).toEqual(first.nodeIds);
    expect(second.reasons).toEqual(first.reasons);
  });

  it("adds every ancestor folder of a selected page exactly once", () => {
    const selection = resolveSetupSelection({ selectedPageIds: ["arc42-context"] });
    expect(selection.pageIds).toEqual(["arc42-context"]);
    expect(selection.folderIds).toEqual(["area-architecture", "arc-arc42"]);
    expect(selection.reasons["arc-arc42"]).toEqual({
      kind: "ancestor",
      of: "arc42-context"
    });
    expect(selection.explicitFolderIds).toEqual([]);
  });

  it("selects the whole subtree when a folder is selected", () => {
    const selection = resolveSetupSelection({
      selectedPageIds: [],
      selectedFolderIds: ["arc-arc42"]
    });
    expect(selection.pageIds).toHaveLength(setupChildPages("arc-arc42").length);
    expect(selection.folderIds).toEqual(["area-architecture", "arc-arc42"]);
    expect(selection.explicitFolderIds).toContain("arc-arc42");
  });

  it("selects nested subfolders and their pages when a root area is selected", () => {
    const selection = resolveSetupSelection({
      selectedPageIds: [],
      selectedFolderIds: ["area-architecture"]
    });
    for (const folder of ["area-architecture", "arc-arc42", "arc-adr", "arc-models"]) {
      expect(selection.folderIds, folder).toContain(folder);
    }
    expect(selection.pageIds).toContain("decision-log");
    expect(selection.pageIds).toContain("c4-code");
  });

  it("keeps an explicitly selected empty folder and drops a derived empty one", () => {
    const explicit = resolveSetupSelection({
      selectedPageIds: [],
      selectedFolderIds: ["arc-adr"]
    });
    // Deselecting the only child page leaves the folder empty but still chosen.
    const withoutPages = resolveSetupSelection({
      selectedPageIds: [],
      selectedFolderIds: ["arc-adr"],
      reasons: {}
    });
    expect(explicit.folderIds).toContain("arc-adr");
    expect(withoutPages.folderIds).toContain("arc-adr");

    const derived = resolveSetupSelection({ selectedPageIds: [] });
    expect(derived.folderIds).toEqual([]);
    expect(derived.pageIds).toEqual([]);
  });

  it("pulls in structural dependencies with a dependency reason", () => {
    const selection = resolveSetupSelection({ selectedPageIds: ["c4-code"] });
    expect(selection.pageIds).toContain("c4-component");
    expect(selection.pageIds).toContain("c4-container");
    expect(selection.pageIds).toContain("c4-context");
    expect(selection.reasons["c4-component"]).toEqual({
      kind: "dependency",
      of: "c4-code"
    });
  });

  it("orders folders parent-first and pages by catalog order", () => {
    const selection = resolveSetupSelection({
      selectedPageIds: [],
      selectedFolderIds: ["area-architecture"]
    });
    const index = (id: string): number => selection.nodeIds.indexOf(id);
    expect(index("area-architecture")).toBeLessThan(index("arc-arc42"));
    expect(index("arc-arc42")).toBeLessThan(index("arc42-introduction"));
    expect(index("arc42-introduction")).toBeLessThan(index("arc42-constraints"));
    expect(index("arc-arc42")).toBeLessThan(index("arc-adr"));
  });

  it("generates no folder for an area with no selection", () => {
    const selection = recommend("personal", "agile", "light");
    const summary = setupSelectionSummary(selection);
    expect(summary.areaIds).not.toContain("operations");
    expect(summary.areaIds).not.toContain("closure");
    expect(selection.folderIds.some((id) => id.startsWith("area-operations"))).toBe(false);
  });

  it("includes the predictive strict hierarchy across planning, requirements, design, quality, release, and closure", () => {
    const selection = recommend("medium-large", "waterfall", "strict");
    const summary = setupSelectionSummary(selection);
    for (const area of [
      "project-management",
      "requirements",
      "design",
      "quality",
      "release",
      "closure"
    ]) {
      expect(summary.areaIds, area).toContain(area);
    }
    for (const page of ["wbs", "schedule", "requirements-traceability", "test-specification", "migration-plan", "closure-report"]) {
      expect(selection.pageIds, page).toContain(page);
    }
  });

  it("includes lightweight arc42, ADR, and C4 for agile standard without forcing all twelve arc42 pages", () => {
    const selection = recommend("small-team", "agile", "standard");
    expect(selection.pageIds).toContain("decision-log");
    expect(selection.pageIds).toContain("c4-context");
    expect(selection.pageIds).toContain("arc42-context");
    const arc42 = setupChildPages("arc-arc42").map((page) => page.id);
    const included = arc42.filter((id) => selection.pageIds.includes(id));
    expect(included.length).toBeGreaterThan(0);
    expect(included.length).toBeLessThan(arc42.length);
  });

  it("prefers agile pages over predictive planning artifacts", () => {
    const agile = recommend("small-team", "agile", "strict");
    const predictive = recommend("small-team", "waterfall", "strict");
    expect(agile.pageIds).toContain("backlog");
    expect(agile.pageIds).toContain("retrospective");
    expect(agile.pageIds).not.toContain("wbs");
    expect(predictive.pageIds).toContain("wbs");
    expect(predictive.pageIds).not.toContain("backlog");
  });

  it("scales the selection with project size", () => {
    const personal = recommend("personal", "hybrid", "strict");
    const large = recommend("medium-large", "hybrid", "strict");
    expect(personal.pageIds).not.toContain("procurement-plan");
    expect(personal.pageIds).not.toContain("stakeholders");
    expect(large.pageIds).toContain("procurement-plan");
    expect(large.pageIds).toContain("stakeholders");
    expect(large.pageIds.length).toBeGreaterThan(personal.pageIds.length);
  });

  it("widens the candidate set with the documentation level only", () => {
    const light = recommend("small-team", "hybrid", "light");
    const standard = recommend("small-team", "hybrid", "standard");
    const strict = recommend("small-team", "hybrid", "strict");
    expect(light.pageIds.length).toBeLessThan(standard.pageIds.length);
    expect(standard.pageIds.length).toBeLessThan(strict.pageIds.length);
    for (const id of light.pageIds) expect(standard.pageIds, id).toContain(id);
    for (const id of standard.pageIds) expect(strict.pageIds, id).toContain(id);
  });

  it("never selects optional templates automatically", () => {
    const selection = recommend("medium-large", "waterfall", "strict");
    expect(selection.pageIds).not.toContain("welcome");
    expect(selection.pageIds).not.toContain("yaml-editing-guide");
    expect(setupPage("welcome")?.requiredness).toBe("optional");
  });

  it("lets a manual selection add security candidates across several areas and drop them individually", () => {
    const security = ["security-requirements", "security-operations"];
    const selection = resolveSetupSelection({ selectedPageIds: security });
    const summary = setupSelectionSummary(selection);
    expect(summary.areaIds).toEqual(expect.arrayContaining(["requirements", "operations"]));

    const reduced = resolveSetupSelection({ selectedPageIds: ["security-requirements"] });
    expect(reduced.pageIds).toEqual(["security-requirements"]);
    expect(reduced.folderIds).toEqual(["area-requirements", "req-system"]);
  });

  it("builds a preview tree that matches the resolved selection", () => {
    const selection = resolveSetupSelection({ selectedPageIds: ["arc42-context", "decision-log"] });
    const tree = setupPreviewTree(selection);
    const flat = flatten(tree);
    expect(flat.map((node) => node.id)).toEqual(selection.nodeIds);
    const architecture = tree.find((node) => node.id === "area-architecture");
    expect(architecture?.kind).toBe("folder");
    expect(architecture?.depth).toBe(0);
    expect(architecture?.children.map((node) => node.id)).toEqual(["arc-arc42", "arc-adr"]);
    expect(flat.find((node) => node.id === "arc42-context")?.depth).toBe(2);
  });

  it("summarizes counts and areas for a proposal", () => {
    const selection = recommend("small-team", "hybrid", "standard");
    const summary = setupSelectionSummary(selection);
    expect(summary.pageCount).toBe(selection.pageIds.length);
    expect(summary.folderCount).toBe(selection.folderIds.length);
    expect(summary.areaIds.length).toBeGreaterThan(0);
    for (const [areaId, pageIds] of Object.entries(summary.pageIdsByArea)) {
      expect(summary.areaIds, areaId).toContain(areaId);
      expect(pageIds.length).toBeGreaterThan(0);
    }
  });

  it("explains each reason in the requested language", () => {
    const ja = setupPackLocale("ja");
    const titleOf = (id: string): string =>
      ja.pages[id]?.title ?? ja.folders[id]?.title ?? id;
    const selection = resolveSetupSelection({ selectedPageIds: ["c4-code"] });
    expect(setupReasonText(selection.reasons["c4-code"], "ja", titleOf)).toBe(
      "利用者が選択しました"
    );
    expect(setupReasonText(selection.reasons["c4-component"], "ja", titleOf)).toContain(
      "コードレベル"
    );
    expect(setupReasonText(selection.reasons["area-architecture"], "ja", titleOf)).toContain(
      "配置先"
    );
    expect(setupReasonText(selection.reasons["area-architecture"], "en", titleOf)).toContain(
      "Required as the location of"
    );
    const recommended = recommend("personal", "agile", "light");
    expect(setupReasonText(recommended.reasons["roadmap"], "ja", titleOf)).toContain("personal");
  });

  it("keeps every selected node inside a defined information area", () => {
    const selection = recommend("medium-large", "hybrid", "strict");
    for (const folderId of selection.folderIds) {
      expect(setupFolder(folderId)?.areaId, folderId).toBeTruthy();
    }
    // Root areas are the only folders without a parent.
    const roots = selection.folderIds.filter((id) => setupFolder(id)?.parentId === undefined);
    expect(roots.every((id) => setupChildFolders(undefined).some((f) => f.id === id))).toBe(true);
  });
});
