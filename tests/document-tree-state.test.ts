import { describe, expect, it } from "vitest";
import {
  defaultExpandedKeys,
  expandedFoldersKey,
  persistExpandedKeys,
  readExpandedKeys
} from "../packages/ui-react/src/shell/document-tree-state.js";
import type { DocumentNavigationNode } from "@vellym-internal/core";

const nodes: DocumentNavigationNode[] = [
  {
    kind: "folder",
    name: "docs",
    path: "docs",
    title: "Docs",
    children: [
      { kind: "folder", name: "design", path: "docs/design", title: "Design", children: [] },
      { kind: "page", name: "intro", slug: "intro", title: "Intro", relativePath: "docs/intro.yaml" }
    ]
  },
  { kind: "page", name: "readme", slug: "readme", title: "Readme", relativePath: "README.yaml" }
];

const projectRoot = "/workspace/project";

function storageOf(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

describe("document tree expansion state", () => {
  it("opens only root folders for a first visit", () => {
    expect([...defaultExpandedKeys(nodes)]).toEqual(["folder:docs"]);
  });

  it("restores only keys that still identify a folder", () => {
    const values = new Map<string, string>([[
      expandedFoldersKey(projectRoot),
      JSON.stringify(["folder:docs", "folder:docs/design", "folder:gone"])
    ]]);
    expect([...readExpandedKeys(["folder:docs", "folder:docs/design"], nodes, projectRoot, storageOf(values))])
      .toEqual(["folder:docs", "folder:docs/design"]);
  });

  it("ignores malformed saved data and continues to use the tree", () => {
    const values = new Map<string, string>([[expandedFoldersKey(projectRoot), "not-json"]]);
    expect([...readExpandedKeys(["folder:docs"], nodes, projectRoot, storageOf(values))])
      .toEqual(["folder:docs"]);
  });

  it("persists only currently available folder keys under the project-scoped key", () => {
    let key = "";
    let value = "";
    const storage = { setItem: (nextKey: string, nextValue: string) => {
      key = nextKey;
      value = nextValue;
    } };
    persistExpandedKeys(
      new Set(["folder:docs", "folder:gone"]),
      ["folder:docs"],
      projectRoot,
      storage
    );
    expect(key).toBe(`vellym.user-settings.v2:${encodeURIComponent(projectRoot)}:_host:navigation.expanded`);
    expect(JSON.parse(value)).toEqual(["folder:docs"]);
  });

  it("keeps expansion state separate for two project roots", () => {
    const values = new Map<string, string>([[
      expandedFoldersKey("/workspace/first"),
      JSON.stringify(["folder:docs/design"])
    ]]);
    expect([...readExpandedKeys(
      ["folder:docs", "folder:docs/design"],
      nodes,
      "/workspace/first",
      storageOf(values)
    )]).toEqual(["folder:docs/design"]);
    expect([...readExpandedKeys(
      ["folder:docs", "folder:docs/design"],
      nodes,
      "/workspace/second",
      storageOf(values)
    )]).toEqual(["folder:docs"]);
  });

  it("drops the pre-rule key without reading it", () => {
    const values = new Map<string, string>([[
      "vellym.navigation.expanded",
      JSON.stringify(["folder:docs/design"])
    ]]);
    expect([...readExpandedKeys(["folder:docs", "folder:docs/design"], nodes, projectRoot, storageOf(values))])
      .toEqual(["folder:docs"]);
    expect(values.has("vellym.navigation.expanded")).toBe(false);
    expect(values.has(expandedFoldersKey(projectRoot))).toBe(false);
  });
});
