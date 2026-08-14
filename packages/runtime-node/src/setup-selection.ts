import type {
  DevelopmentMethod,
  DocumentationLevel,
  ProjectSize
} from "./setup-catalog.js";
import {
  setupChildFolders,
  setupChildPages,
  setupFolder,
  setupFolderChain,
  setupPage,
  setupPages,
  type SetupFolderTemplate,
  type SetupPageTemplate
} from "./setup-pack.js";

/**
 * Why a node ended up in a selection. `ancestor` and `dependency` are derived:
 * the user picked something else and the catalog required this node as well.
 */
export type SetupNodeReason =
  | { kind: "criteria"; size: ProjectSize; method: DevelopmentMethod; level: DocumentationLevel }
  | { kind: "dependency"; of: string }
  | { kind: "ancestor"; of: string }
  | { kind: "explicit" };

export interface SetupNodeSelection {
  /** Selected page template ids, in generation order. */
  pageIds: string[];
  /** Every folder that will be generated, shallowest first. */
  folderIds: string[];
  /** Folders the user picked directly; these survive even with zero child pages. */
  explicitFolderIds: string[];
  /** Folders and pages together, parent before child, siblings by `order`. */
  nodeIds: string[];
  reasons: Record<string, SetupNodeReason>;
}

export interface SetupSelectionInput {
  selectedPageIds: Iterable<string>;
  selectedFolderIds?: Iterable<string>;
  reasons?: Record<string, SetupNodeReason>;
}

export interface SetupRecommendationCriteria {
  size: ProjectSize;
  method: DevelopmentMethod;
  level: DocumentationLevel;
}

export interface SetupSelectionSummary {
  folderCount: number;
  pageCount: number;
  /** Information areas that will actually get a folder, in catalog order. */
  areaIds: string[];
  pageIdsByArea: Record<string, string[]>;
}

export interface SetupPreviewNode {
  id: string;
  kind: "folder" | "page";
  depth: number;
  parentId?: string;
  areaId?: string;
  reason?: SetupNodeReason;
  children: SetupPreviewNode[];
}

const LEVEL_RANK: Record<DocumentationLevel, number> = {
  light: 0,
  standard: 1,
  strict: 2
};

/**
 * Picks page templates for the given criteria, then expands the result into a
 * hierarchy: dependencies first, then every ancestor folder up to the root area.
 * Deterministic for a given pack version and input.
 */
export function recommendSetupNodes(
  criteria: SetupRecommendationCriteria
): SetupNodeSelection {
  const pageIds = new Set<string>();
  const reasons: Record<string, SetupNodeReason> = {};
  for (const page of setupPages()) {
    if (page.requiredness === "optional") continue;
    if (LEVEL_RANK[page.minimumLevel] > LEVEL_RANK[criteria.level]) continue;
    if (!page.sizes.includes(criteria.size)) continue;
    if (!page.methods.includes(criteria.method)) continue;
    pageIds.add(page.id);
    reasons[page.id] = { kind: "criteria", ...criteria };
  }
  return resolveSetupSelection({ selectedPageIds: pageIds, reasons });
}

/**
 * Normalizes any selection - recommended or hand picked - into the exact set of
 * folders and pages to generate.
 *
 * Selecting a folder selects its whole subtree. Selecting a page pulls in its
 * dependencies and every ancestor folder. A folder that is not explicitly
 * selected and ends up with no selected descendant is dropped, so unused areas
 * never reach the filesystem.
 */
export function resolveSetupSelection(input: SetupSelectionInput): SetupNodeSelection {
  const reasons: Record<string, SetupNodeReason> = { ...input.reasons };
  const pageIds = new Set<string>();
  const explicitFolderIds = new Set<string>();

  const addPage = (id: string, reason: SetupNodeReason): void => {
    if (!setupPage(id) || pageIds.has(id)) return;
    pageIds.add(id);
    reasons[id] ??= reason;
  };

  // A selected folder means "everything under here".
  const addSubtree = (folderId: string, reason: SetupNodeReason): void => {
    if (!setupFolder(folderId) || explicitFolderIds.has(folderId)) return;
    explicitFolderIds.add(folderId);
    reasons[folderId] ??= reason;
    for (const page of setupChildPages(folderId)) addPage(page.id, { kind: "explicit" });
    for (const child of setupChildFolders(folderId)) addSubtree(child.id, { kind: "explicit" });
  };

  for (const id of input.selectedFolderIds ?? []) addSubtree(id, { kind: "explicit" });
  for (const id of input.selectedPageIds) addPage(id, { kind: "explicit" });

  // Dependencies are structural: a page that depends on another needs it present.
  const pending = [...pageIds];
  while (pending.length) {
    const current = pending.pop()!;
    for (const dependency of setupPage(current)?.dependencies ?? []) {
      if (pageIds.has(dependency)) continue;
      addPage(dependency, { kind: "dependency", of: current });
      pending.push(dependency);
    }
  }

  // Every selected page needs its ancestor folders, added once each.
  const folderIds = new Set<string>(explicitFolderIds);
  for (const pageId of pageIds) {
    const page = setupPage(pageId);
    if (!page?.parentFolderId) continue;
    for (const folder of setupFolderChain(page.parentFolderId)) {
      if (folderIds.has(folder.id)) continue;
      folderIds.add(folder.id);
      reasons[folder.id] ??= { kind: "ancestor", of: pageId };
    }
  }

  // An explicit folder keeps its own ancestors even when it holds no pages.
  for (const folderId of explicitFolderIds) {
    for (const folder of setupFolderChain(folderId)) {
      if (folderIds.has(folder.id)) continue;
      folderIds.add(folder.id);
      reasons[folder.id] ??= { kind: "ancestor", of: folderId };
    }
  }

  // Drop derived folders that lost every descendant; keep explicitly chosen ones.
  const keeps = (folderId: string): boolean => {
    if (explicitFolderIds.has(folderId)) return true;
    if (setupChildPages(folderId).some((page) => pageIds.has(page.id))) return true;
    return setupChildFolders(folderId).some(
      (child) => folderIds.has(child.id) && keeps(child.id)
    );
  };
  for (const folderId of [...folderIds]) {
    if (!keeps(folderId)) {
      folderIds.delete(folderId);
      delete reasons[folderId];
    }
  }

  const ordered = orderNodes(folderIds, pageIds);
  return {
    pageIds: ordered.filter((id) => pageIds.has(id)),
    folderIds: ordered.filter((id) => folderIds.has(id)),
    explicitFolderIds: [...explicitFolderIds].filter((id) => folderIds.has(id)),
    nodeIds: ordered,
    reasons: Object.fromEntries(ordered.map((id) => [id, reasons[id] ?? { kind: "explicit" }]))
  };
}

/** Depth-first: pages of a folder before its child folders, each by `order`. */
function orderNodes(folderIds: Set<string>, pageIds: Set<string>): string[] {
  const result: string[] = [];
  const visit = (parentId?: string): void => {
    for (const page of setupChildPages(parentId)) {
      if (pageIds.has(page.id)) result.push(page.id);
    }
    for (const folder of setupChildFolders(parentId)) {
      if (!folderIds.has(folder.id)) continue;
      result.push(folder.id);
      visit(folder.id);
    }
  };
  visit(undefined);
  return result;
}

export function setupSelectionSummary(
  selection: SetupNodeSelection
): SetupSelectionSummary {
  const pageIdsByArea: Record<string, string[]> = {};
  const areaIds: string[] = [];
  for (const folderId of selection.folderIds) {
    const areaId = setupFolder(folderId)?.areaId;
    if (areaId && !areaIds.includes(areaId)) areaIds.push(areaId);
  }
  for (const pageId of selection.pageIds) {
    const parentId = setupPage(pageId)?.parentFolderId;
    const areaId = parentId ? setupFolder(parentId)?.areaId : undefined;
    if (!areaId) continue;
    pageIdsByArea[areaId] = [...(pageIdsByArea[areaId] ?? []), pageId];
  }
  return {
    folderCount: selection.folderIds.length,
    pageCount: selection.pageIds.length,
    areaIds,
    pageIdsByArea
  };
}

/** Builds the tree the wizard shows in STEP 2 and STEP 3 from a resolved selection. */
export function setupPreviewTree(selection: SetupNodeSelection): SetupPreviewNode[] {
  const folderIds = new Set(selection.folderIds);
  const pageIds = new Set(selection.pageIds);
  const build = (parentId: string | undefined, depth: number): SetupPreviewNode[] => {
    const nodes: SetupPreviewNode[] = [];
    for (const page of setupChildPages(parentId)) {
      if (!pageIds.has(page.id)) continue;
      nodes.push(pageNode(page, depth, selection));
    }
    for (const folder of setupChildFolders(parentId)) {
      if (!folderIds.has(folder.id)) continue;
      nodes.push({
        id: folder.id,
        kind: "folder",
        depth,
        ...(folder.parentId === undefined ? {} : { parentId: folder.parentId }),
        areaId: folder.areaId,
        ...(selection.reasons[folder.id] ? { reason: selection.reasons[folder.id] } : {}),
        children: build(folder.id, depth + 1)
      });
    }
    return nodes;
  };
  return build(undefined, 0);
}

function pageNode(
  page: SetupPageTemplate,
  depth: number,
  selection: SetupNodeSelection
): SetupPreviewNode {
  const parent: SetupFolderTemplate | undefined = page.parentFolderId
    ? setupFolder(page.parentFolderId)
    : undefined;
  return {
    id: page.id,
    kind: "page",
    depth,
    ...(page.parentFolderId === undefined ? {} : { parentId: page.parentFolderId }),
    ...(parent ? { areaId: parent.areaId } : {}),
    ...(selection.reasons[page.id] ? { reason: selection.reasons[page.id] } : {}),
    children: []
  };
}

/** Human readable reason text, used for previews and the setup plan. */
export function setupReasonText(
  reason: SetupNodeReason | undefined,
  locale: "ja" | "en",
  titleOf: (nodeId: string) => string
): string {
  if (!reason) return "";
  switch (reason.kind) {
    case "criteria":
      return locale === "ja"
        ? `規模 ${reason.size} / 開発方式 ${reason.method} / 文書化レベル ${reason.level} に該当します`
        : `Matches size ${reason.size}, method ${reason.method}, level ${reason.level}`;
    case "dependency":
      return locale === "ja"
        ? `${titleOf(reason.of)}が参照するため追加しました`
        : `Added because ${titleOf(reason.of)} refers to it`;
    case "ancestor":
      return locale === "ja"
        ? `${titleOf(reason.of)}の配置先として必要です`
        : `Required as the location of ${titleOf(reason.of)}`;
    case "explicit":
      return locale === "ja" ? "利用者が選択しました" : "Selected by the user";
  }
}
