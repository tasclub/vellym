import type {
  DocumentNavigation,
  DocumentNavigationFolder,
  DocumentNavigationNode,
  FolderSummary,
  PageSummary
} from "@vellym-internal/core";
import type { DropPosition } from "react-aria-components";

import type { StructureInput } from "../shared/api.js";

function parentPath(relativePath: string): string {
  const parts = relativePath.replaceAll("\\", "/").split("/");
  parts.pop();
  return parts.join("/");
}

function basename(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").split("/").at(-1) ?? relativePath;
}

/**
 * そのフォルダの直下にあるものを、画面に見えている並びのまま返す。
 *
 * 並べ替えは**見えている順**を基準にする。`_index.yaml`の`order`は一部しか
 * 書かれていないことがあり、そちらを基準にすると画面と違う結果になる。
 */
export function directOrder(
  navigation: DocumentNavigation,
  folderPath: string
): string[] {
  const visit = (
    nodes: DocumentNavigationNode[]
  ): DocumentNavigationFolder | undefined => {
    for (const node of nodes) {
      if (node.kind !== "folder") continue;
      if (node.path === folderPath) return node;
      const nested = visit(node.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const children =
    folderPath === "" ? navigation.tree : visit(navigation.tree)?.children ?? [];
  return children.map((child) =>
    child.kind === "folder" ? basename(child.path) : basename(child.relativePath)
  );
}

export interface TreeMove {
  sourceKey: string;
  targetKey: string;
  position: DropPosition;
  pages: readonly PageSummary[];
  folders: readonly FolderSummary[];
  navigation: DocumentNavigation;
}

/**
 * 文書ツリーの掴んで動かす操作を、構造変更の入力へ翻訳する。
 *
 * 同じ親の中で位置を変えるだけなら並べ替え、親をまたぐなら移動になる。
 * 移動先の並びも一緒に決める。**移動と並べ替えを2回に分けない。** 分けると
 * 途中の状態がファイルへ書かれ、取り消しが2段になる。
 *
 * 掴んだものか落とし先が見つからない場合は`undefined`を返す。呼ぶ側は
 * 何もしない。
 */
export function planTreeMove(move: TreeMove): StructureInput | undefined {
  const { sourceKey, targetKey, position, pages, folders, navigation } = move;
  const sourcePage = sourceKey.startsWith("page:")
    ? pages.find((page) => page.name === sourceKey.slice(5))
    : undefined;
  const sourceFolder = sourceKey.startsWith("folder:")
    ? folders.find((folder) => folder.path === sourceKey.slice(7))
    : undefined;
  const targetPage = targetKey.startsWith("page:")
    ? pages.find((page) => page.name === targetKey.slice(5))
    : undefined;
  const targetFolder = targetKey.startsWith("folder:")
    ? folders.find((folder) => folder.path === targetKey.slice(7))
    : undefined;
  if ((!sourcePage && !sourceFolder) || (!targetPage && !targetFolder)) return undefined;

  const sourceParent = sourcePage
    ? parentPath(sourcePage.relativePath)
    : parentPath(sourceFolder!.path);
  const targetParent =
    targetFolder && position === "on"
      ? targetFolder.path
      : targetPage
        ? parentPath(targetPage.relativePath)
        : parentPath(targetFolder!.path);
  const targetName = targetPage
    ? basename(targetPage.relativePath)
    : targetFolder?.path
      ? basename(targetFolder.path)
      : undefined;
  const sourceName = sourcePage
    ? basename(sourcePage.relativePath)
    : basename(sourceFolder!.path);

  if (sourceParent === targetParent && position !== "on") {
    const ordered = directOrder(navigation, targetParent);
    const next = ordered.filter((item) => item !== sourceName);
    const targetIndex = targetName ? next.indexOf(targetName) : next.length;
    next.splice(
      Math.max(0, targetIndex + (position === "after" ? 1 : 0)),
      0,
      sourceName
    );
    return { type: "reorder", folderPath: targetParent, order: next };
  }

  const destinationOrder = directOrder(navigation, targetParent).filter(
    (item) => item !== sourceName
  );
  if (position === "on" || !targetName) {
    destinationOrder.push(sourceName);
  } else {
    const targetIndex = destinationOrder.indexOf(targetName);
    destinationOrder.splice(
      Math.max(0, targetIndex + (position === "after" ? 1 : 0)),
      0,
      sourceName
    );
  }
  if (sourcePage) {
    return {
      type: "move-page",
      pageId: sourcePage.name,
      destinationPath: targetParent,
      destinationOrder
    };
  }
  return {
    type: "move-folder",
    folderPath: sourceFolder!.path,
    destinationPath: targetParent,
    destinationOrder
  };
}
