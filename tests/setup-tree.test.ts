import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setupCatalog } from "@vellym-internal/runtime-node";
import type { SetupCatalog } from "../packages/ui-react/src/shared/api.js";
import {
  buildCatalogIndex,
  checkState,
  countNodes,
  estimateSelection,
  filterTree,
  resolveSelection,
  selectedTree,
  selectionIds,
  toggleNode,
  treeForIds,
  type SetupSelectionState
} from "../packages/ui-react/src/setup/setup-catalog-tree.js";
import { SetupTree } from "../packages/ui-react/src/setup/setup-tree.js";

const catalog = setupCatalog("ja") as unknown as SetupCatalog;
const index = buildCatalogIndex(catalog);

function selection(pageIds: string[] = [], folderIds: string[] = []): SetupSelectionState {
  return { pageIds: new Set(pageIds), explicitFolderIds: new Set(folderIds) };
}

describe("setup catalog tree", () => {
  it("mirrors the catalog hierarchy", () => {
    expect(index.roots).toHaveLength(catalog.areas.length + 4);
    const architecture = index.byId.get("area-architecture");
    expect(architecture?.kind).toBe("folder");
    expect(architecture?.children.map((node) => node.id)).toEqual([
      "arc-arc42",
      "arc-adr",
      "arc-models"
    ]);
    expect(index.ancestors.get("arc42-context")).toEqual(["area-architecture", "arc-arc42"]);
  });

  it("adds every ancestor folder once when a single page is selected", () => {
    const resolved = resolveSelection(index, selection(["arc42-context"]));
    expect([...resolved.folderIds].sort()).toEqual(["arc-arc42", "area-architecture"]);
    expect([...resolved.pageIds]).toEqual(["arc42-context"]);
  });

  it("selects the whole subtree when a folder is checked", () => {
    const next = toggleNode(index, selection(), "arc-arc42", true);
    expect(next.pageIds.size).toBe(12);
    expect(next.explicitFolderIds.has("arc-arc42")).toBe(true);
    expect(checkState(index, next, "arc-arc42")).toBe("checked");
    expect(checkState(index, next, "area-architecture")).toBe("indeterminate");
  });

  it("clears the whole subtree when a folder is unchecked", () => {
    const checked = toggleNode(index, selection(), "area-architecture", true);
    const cleared = toggleNode(index, checked, "area-architecture", false);
    expect(cleared.pageIds.size).toBe(0);
    expect(cleared.explicitFolderIds.size).toBe(0);
    expect(checkState(index, cleared, "area-architecture")).toBe("unchecked");
  });

  it("marks a partially selected folder as indeterminate", () => {
    const partial = toggleNode(index, selection(), "arc42-context", true);
    expect(checkState(index, partial, "arc-arc42")).toBe("indeterminate");
    expect(checkState(index, partial, "arc42-context")).toBe("checked");
    expect(checkState(index, partial, "arc42-constraints")).toBe("unchecked");
  });

  it("drops a folder that lost every child but keeps an explicitly chosen one", () => {
    const explicit = toggleNode(index, selection(), "arc-models", true);
    const withoutPages = { ...explicit, pageIds: new Set<string>() };
    expect(resolveSelection(index, withoutPages).folderIds.has("arc-models")).toBe(true);

    const derived = resolveSelection(index, selection(["arc42-context"]));
    expect(derived.folderIds.has("arc-adr")).toBe(false);
    expect(derived.folderIds.has("arc-models")).toBe(false);
  });

  it("keeps the selection unchanged when the filter changes", () => {
    const current = toggleNode(index, selection(), "arc42-context", true);
    const filtered = filterTree(index.roots, {
      query: "テスト",
      areaId: "",
      referenceModel: ""
    });
    expect(filtered.length).toBeGreaterThan(0);
    expect(checkState(index, current, "arc42-context")).toBe("checked");
    expect(resolveSelection(index, current).pageIds.has("arc42-context")).toBe(true);
  });

  it("filters by information area and by reference model without hiding matching ancestors", () => {
    const byArea = filterTree(index.roots, {
      query: "",
      areaId: "architecture",
      referenceModel: ""
    });
    expect(byArea.map((node) => node.id)).toEqual(["area-architecture"]);

    const security = filterTree(index.roots, {
      query: "",
      areaId: "",
      referenceModel: "security"
    });
    const areas = new Set(
      security.flatMap(function collect(node): string[] {
        return [node.areaId ?? "", ...node.children.flatMap(collect)];
      })
    );
    expect(areas).toContain("requirements");
    expect(areas).toContain("operations");
  });

  it("counts folders and pages of the tree a proposal produces", () => {
    const light = estimateSelection(index, "small-team", "hybrid", "light");
    const strict = estimateSelection(index, "small-team", "hybrid", "strict");
    const lightCounts = countNodes(selectedTree(index.roots, light));
    const strictCounts = countNodes(selectedTree(index.roots, strict));
    expect(lightCounts.pages).toBeLessThan(strictCounts.pages);
    expect(lightCounts.folders).toBeLessThanOrEqual(strictCounts.folders);
    expect(lightCounts.pages).toBe(light.pageIds.size);
    expect(lightCounts.folders).toBe(light.folderIds.size);
  });
});

describe("SetupTree markup", () => {
  function render(state: SetupSelectionState, expanded: string[], readOnly = false): string {
    return renderToStaticMarkup(
      createElement(SetupTree, {
        index,
        nodes: selectedTree(index.roots, resolveSelection(index, state)),
        selection: state,
        expanded: new Set(expanded),
        label: "tree",
        language: "ja" as const,
        readOnly,
        onToggleExpanded: () => {},
        onToggleSelected: () => {}
      })
    );
  }

  it("exposes hierarchy, level, and checked state to assistive technology", () => {
    const state = toggleNode(index, selection(), "arc42-context", true);
    const markup = render(state, ["area-architecture", "arc-arc42"]);
    expect(markup).toContain('role="tree"');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-level="1"');
    expect(markup).toContain('aria-level="3"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-checked="mixed"');
    expect(markup).toContain('aria-checked="true"');
  });

  it("keeps exactly one item in the tab order", () => {
    const state = toggleNode(index, selection(), "arc-arc42", true);
    const markup = render(state, ["area-architecture", "arc-arc42"]);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect((markup.match(/role="treeitem"/g) ?? []).length).toBeGreaterThan(1);
  });

  it("shows the reference model as a hint rather than a conformance claim", () => {
    const state = toggleNode(index, selection(), "arc42-context", true);
    const markup = render(state, ["area-architecture", "arc-arc42"]);
    expect(markup).toContain("参考: arc42");
    expect(markup).not.toContain("準拠");
    expect(markup).not.toContain("不足");
  });

  it("omits checkboxes in the read-only comparison tree", () => {
    const state = toggleNode(index, selection(), "arc42-context", true);
    const markup = render(state, ["area-architecture"], true);
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain("aria-checked");
  });

  it("keeps an unchecked row visible so it can be restored", () => {
    // The review step captures the selected ids, then only ever grows that set.
    const chosen = toggleNode(index, selection(), "arc-arc42", true);
    const scope = selectionIds(resolveSelection(index, chosen));
    const cleared = toggleNode(index, chosen, "arc42-context", false);

    const reviewIds = new Set([...scope, ...selectionIds(resolveSelection(index, cleared))]);
    const review = treeForIds(index.roots, reviewIds);
    const flat = review.flatMap(function collect(node): string[] {
      return [node.id, ...node.children.flatMap(collect)];
    });
    expect(flat).toContain("arc42-context");
    expect(checkState(index, cleared, "arc42-context")).toBe("unchecked");

    // The generated tree, which drives the counts, drops it.
    const generated = selectedTree(index.roots, resolveSelection(index, cleared));
    const generatedIds = generated.flatMap(function collect(node): string[] {
      return [node.id, ...node.children.flatMap(collect)];
    });
    expect(generatedIds).not.toContain("arc42-context");

    // Re-checking restores it to the generated tree.
    const restored = toggleNode(index, cleared, "arc42-context", true);
    expect(resolveSelection(index, restored).pageIds.has("arc42-context")).toBe(true);
  });

  it("labels a still-visible unchecked row as one that will not be created", () => {
    const chosen = toggleNode(index, selection(), "arc-arc42", true);
    const scope = selectionIds(resolveSelection(index, chosen));
    const cleared = toggleNode(index, chosen, "arc42-context", false);
    const generated = selectionIds(resolveSelection(index, cleared));
    const omittedIds = new Set([...scope].filter((id) => !generated.has(id)));
    expect(omittedIds.has("arc42-context")).toBe(true);

    const markup = renderToStaticMarkup(
      createElement(SetupTree, {
        index,
        nodes: treeForIds(index.roots, new Set([...scope, ...generated])),
        selection: cleared,
        expanded: new Set(["area-architecture", "arc-arc42"]),
        label: "tree",
        language: "ja" as const,
        omittedIds,
        onToggleExpanded: () => {},
        onToggleSelected: () => {}
      })
    );
    expect(markup).toContain("作成しません");
    // CSS moduleのクラス名はハッシュ付きになる。**文字列そのものを固定しない。**
    // 見たいのは「作成しない行だと分かる印が付いていること」である。
    expect(markup).toMatch(/class="[^"]*setup-tree-item[^"]*page[^"]*omitted/);
    expect(markup).toContain('aria-checked="false"');
  });

  it("renders an empty tree as a message instead of an empty group", () => {
    const markup = render(selection(), []);
    expect(markup).toContain("該当するFolder・Pageがありません。");
    expect(markup).not.toContain('role="tree"');
  });
});
