import { describe, expect, it } from "vitest";
import { buildDocumentNavigation } from "@vellym-internal/core";
import type { FolderSummary, PageSummary } from "@vellym-internal/core";
import { planTreeMove } from "../packages/ui-react/src/shell/tree-move.js";

const pages: PageSummary[] = [
  {
    name: "overview",
    title: "概要",
    relativePath: "design/overview.yaml",
    readOnly: false
  },
  {
    name: "architecture",
    title: "アーキテクチャ",
    relativePath: "design/architecture.yaml",
    readOnly: false
  },
  {
    name: "requirements",
    title: "要求一覧",
    relativePath: "requirements.yaml",
    readOnly: false
  }
];

const folders: FolderSummary[] = [
  { name: "design", path: "design", title: "設計", order: [], readOnly: false, readOnlyReasons: [] },
  { name: "archive", path: "archive", title: "書庫", order: [], readOnly: false, readOnlyReasons: [] }
];

const navigation = buildDocumentNavigation(pages);

describe("planTreeMove", () => {
  it("reorders within the same folder instead of moving the file", () => {
    // 同じ親の中での入れ替えは並べ替えである。ファイルは動かさない。
    const input = planTreeMove({
      sourceKey: "page:architecture",
      targetKey: "page:overview",
      position: "before",
      pages,
      folders,
      navigation
    });

    expect(input).toEqual({
      type: "reorder",
      folderPath: "design",
      order: ["architecture.yaml", "overview.yaml"]
    });
  });

  it("moves a page into a folder when dropped onto it", () => {
    // 落とし先がフォルダそのものなら、その中のいちばん後ろへ入れる。
    const input = planTreeMove({
      sourceKey: "page:requirements",
      targetKey: "folder:design",
      position: "on",
      pages,
      folders,
      navigation
    });

    expect(input).toEqual({
      type: "move-page",
      pageId: "requirements",
      destinationPath: "design",
      destinationOrder: ["architecture.yaml", "overview.yaml", "requirements.yaml"]
    });
  });

  it("moves across folders and decides the destination order in one step", () => {
    // 移動と並べ替えを2回に分けない。分けると途中の状態がファイルへ書かれる。
    const input = planTreeMove({
      sourceKey: "page:requirements",
      targetKey: "page:architecture",
      position: "before",
      pages,
      folders,
      navigation
    });

    expect(input).toEqual({
      type: "move-page",
      pageId: "requirements",
      destinationPath: "design",
      destinationOrder: ["requirements.yaml", "architecture.yaml", "overview.yaml"]
    });
  });

  it("moves a folder with its destination order", () => {
    const input = planTreeMove({
      sourceKey: "folder:archive",
      targetKey: "folder:design",
      position: "on",
      pages,
      folders,
      navigation
    });

    expect(input).toEqual({
      type: "move-folder",
      folderPath: "archive",
      destinationPath: "design",
      destinationOrder: ["architecture.yaml", "overview.yaml", "archive"]
    });
  });

  it("does nothing when either end of the drag is unknown", () => {
    // 掴んだものが見つからないまま構造を書き換えない。
    expect(
      planTreeMove({
        sourceKey: "page:missing",
        targetKey: "page:overview",
        position: "before",
        pages,
        folders,
        navigation
      })
    ).toBeUndefined();
  });
});
