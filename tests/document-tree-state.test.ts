import { describe, expect, it } from "vitest";
import {
  defaultExpandedKeys,
  EXPANDED_FOLDERS_KEY,
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

describe("document tree expansion state", () => {
  it("opens only root folders for a first visit", () => {
    expect([...defaultExpandedKeys(nodes)]).toEqual(["folder:docs"]);
  });

  it("restores only keys that still identify a folder", () => {
    const storage = {
      getItem: () => JSON.stringify(["folder:docs", "folder:docs/design", "folder:gone"])
    };
    expect([...readExpandedKeys(["folder:docs", "folder:docs/design"], nodes, storage)])
      .toEqual(["folder:docs", "folder:docs/design"]);
  });

  it("ignores malformed saved data and continues to use the tree", () => {
    const storage = { getItem: () => "not-json" };
    expect([...readExpandedKeys(["folder:docs"], nodes, storage)])
      .toEqual(["folder:docs"]);
  });

  it("persists only currently available folder keys", () => {
    let key = "";
    let value = "";
    const storage = { setItem: (nextKey: string, nextValue: string) => {
      key = nextKey;
      value = nextValue;
    } };
    persistExpandedKeys(
      new Set(["folder:docs", "folder:gone"]),
      ["folder:docs"],
      storage
    );
    expect(key).toBe(EXPANDED_FOLDERS_KEY);
    expect(JSON.parse(value)).toEqual(["folder:docs"]);
  });
});
