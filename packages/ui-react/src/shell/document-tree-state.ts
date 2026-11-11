import type { Key } from "react-aria-components";
import type { DocumentNavigationNode } from "@vellym-internal/core";
import {
  HOST_OWNER,
  normalizedProjectRoot,
  userSettingsKey
} from "../shared/user-settings.js";

/** Key used before the personal-settings rule; its paths cannot be assigned to a project. */
const LEGACY_EXPANDED_FOLDERS_KEY = "vellym.navigation.expanded";

/** Expanded folders name project paths, so the key is scoped to the project. */
export function expandedFoldersKey(projectRoot: string): string {
  return userSettingsKey(
    normalizedProjectRoot(projectRoot),
    HOST_OWNER,
    "navigation.expanded"
  );
}

export function folderKey(node: DocumentNavigationNode): string {
  return node.kind === "folder" ? `folder:${node.path}` : `page:${node.name}`;
}

export function allFolderKeys(nodes: DocumentNavigationNode[]): Key[] {
  return nodes.flatMap((node) =>
    node.kind === "folder"
      ? [folderKey(node), ...allFolderKeys(node.children)]
      : []
  );
}

export function defaultExpandedKeys(nodes: DocumentNavigationNode[]): Set<Key> {
  // 初回はルート直下だけ開く。中の階層まで一斉に開かず、大きな文書群でも
  // 最初の画面に収まる入口を見せる。
  return new Set(nodes.filter((node) => node.kind === "folder").map(folderKey));
}

export function readExpandedKeys(
  folderKeys: readonly Key[],
  nodes: DocumentNavigationNode[],
  projectRoot: string,
  storage?: Pick<Storage, "getItem" | "removeItem">
): Set<Key> {
  try {
    // 旧鍵はどのプロジェクトのものか決められないので読まず、掃除だけする。
    storage?.removeItem(LEGACY_EXPANDED_FOLDERS_KEY);
    const stored = storage?.getItem(expandedFoldersKey(projectRoot));
    if (stored == null) return defaultExpandedKeys(nodes);
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value)) return defaultExpandedKeys(nodes);
    const available = new Set(folderKeys.map(String));
    return new Set(value.filter((key): key is string =>
      typeof key === "string" && available.has(key)
    ));
  } catch {
    return defaultExpandedKeys(nodes);
  }
}

export function persistExpandedKeys(
  keys: Set<Key>,
  folderKeys: readonly Key[],
  projectRoot: string,
  storage?: Pick<Storage, "setItem">
): void {
  try {
    const available = new Set(folderKeys.map(String));
    storage?.setItem(
      expandedFoldersKey(projectRoot),
      JSON.stringify([...keys].map(String).filter((key) => available.has(key)))
    );
  } catch {
    // 個人設定を保存できなくてもツリーの操作は続けられる。
  }
}
