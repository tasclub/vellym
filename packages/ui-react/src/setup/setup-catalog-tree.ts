import type {
  DevelopmentMethod,
  DocumentationLevel,
  ProjectSize,
  SetupCatalog,
  SetupCatalogFolder,
  SetupCatalogPage,
  SetupReferenceModel
} from "../shared/api.js";

export type SetupNodeKind = "folder" | "page";

export interface SetupTreeNode {
  id: string;
  kind: SetupNodeKind;
  parentId?: string;
  areaId?: string;
  title: string;
  description: string;
  referenceModels: SetupReferenceModel[];
  children: SetupTreeNode[];
}

export interface SetupCatalogIndex {
  catalog: SetupCatalog;
  roots: SetupTreeNode[];
  byId: Map<string, SetupTreeNode>;
  folderById: Map<string, SetupCatalogFolder>;
  pageById: Map<string, SetupCatalogPage>;
  /** Ancestor folder ids of any node, shallowest first. */
  ancestors: Map<string, string[]>;
}

export interface SetupSelectionState {
  pageIds: Set<string>;
  /** Folders the user checked directly; kept even when they hold no pages. */
  explicitFolderIds: Set<string>;
}

export interface SetupResolvedSelection {
  pageIds: Set<string>;
  folderIds: Set<string>;
}

const LEVEL_RANK: Record<DocumentationLevel, number> = {
  light: 0,
  standard: 1,
  strict: 2
};

export function buildCatalogIndex(catalog: SetupCatalog): SetupCatalogIndex {
  const folderById = new Map(catalog.folders.map((folder) => [folder.id, folder]));
  const pageById = new Map(catalog.pages.map((page) => [page.id, page]));
  const byId = new Map<string, SetupTreeNode>();

  const folderChildren = new Map<string, SetupCatalogFolder[]>();
  for (const folder of catalog.folders) {
    const key = folder.parentId ?? "";
    folderChildren.set(key, [...(folderChildren.get(key) ?? []), folder]);
  }
  const pageChildren = new Map<string, SetupCatalogPage[]>();
  for (const page of catalog.pages) {
    const key = page.parentFolderId ?? "";
    pageChildren.set(key, [...(pageChildren.get(key) ?? []), page]);
  }
  for (const list of folderChildren.values()) list.sort((a, b) => a.order - b.order);
  for (const list of pageChildren.values()) list.sort((a, b) => a.order - b.order);

  const build = (parentId: string | undefined): SetupTreeNode[] => {
    const key = parentId ?? "";
    const nodes: SetupTreeNode[] = [];
    for (const page of pageChildren.get(key) ?? []) {
      const node: SetupTreeNode = {
        id: page.id,
        kind: "page",
        ...(page.parentFolderId === undefined ? {} : { parentId: page.parentFolderId }),
        ...(page.areaId === undefined ? {} : { areaId: page.areaId }),
        title: page.title,
        description: page.description,
        referenceModels: page.referenceModels,
        children: []
      };
      byId.set(node.id, node);
      nodes.push(node);
    }
    for (const folder of folderChildren.get(key) ?? []) {
      const node: SetupTreeNode = {
        id: folder.id,
        kind: "folder",
        ...(folder.parentId === undefined ? {} : { parentId: folder.parentId }),
        areaId: folder.areaId,
        title: folder.title,
        description: folder.description,
        referenceModels: folder.referenceModels,
        children: build(folder.id)
      };
      byId.set(node.id, node);
      nodes.push(node);
    }
    return nodes;
  };
  const roots = build(undefined);

  const ancestors = new Map<string, string[]>();
  const chainOf = (folderId: string | undefined): string[] => {
    const chain: string[] = [];
    let cursor = folderId ? folderById.get(folderId) : undefined;
    while (cursor) {
      chain.unshift(cursor.id);
      cursor = cursor.parentId ? folderById.get(cursor.parentId) : undefined;
    }
    return chain;
  };
  for (const folder of catalog.folders) ancestors.set(folder.id, chainOf(folder.parentId));
  for (const page of catalog.pages) ancestors.set(page.id, chainOf(page.parentFolderId));

  return { catalog, roots, byId, folderById, pageById, ancestors };
}

function descendants(node: SetupTreeNode): SetupTreeNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

/**
 * Mirrors the server: ancestors of a selected page come along, an explicitly
 * selected folder survives with no pages, and a folder that lost every
 * descendant disappears. The server stays authoritative; this keeps the tree
 * responsive between previews.
 */
export function resolveSelection(
  index: SetupCatalogIndex,
  state: SetupSelectionState
): SetupResolvedSelection {
  const pageIds = new Set(state.pageIds);
  const folderIds = new Set<string>();

  for (const pageId of pageIds) {
    for (const ancestor of index.ancestors.get(pageId) ?? []) folderIds.add(ancestor);
  }
  for (const folderId of state.explicitFolderIds) {
    folderIds.add(folderId);
    for (const ancestor of index.ancestors.get(folderId) ?? []) folderIds.add(ancestor);
  }

  const keeps = (folderId: string): boolean => {
    if (state.explicitFolderIds.has(folderId)) return true;
    const node = index.byId.get(folderId);
    if (!node) return false;
    return node.children.some((child) =>
      child.kind === "page" ? pageIds.has(child.id) : folderIds.has(child.id) && keeps(child.id)
    );
  };
  for (const folderId of [...folderIds]) {
    if (!keeps(folderId)) folderIds.delete(folderId);
  }
  return { pageIds, folderIds };
}

export function toggleNode(
  index: SetupCatalogIndex,
  state: SetupSelectionState,
  nodeId: string,
  checked: boolean
): SetupSelectionState {
  const pageIds = new Set(state.pageIds);
  const explicitFolderIds = new Set(state.explicitFolderIds);
  const node = index.byId.get(nodeId);
  if (!node) return state;

  if (node.kind === "page") {
    if (checked) pageIds.add(nodeId);
    else pageIds.delete(nodeId);
    return { pageIds, explicitFolderIds };
  }

  const subtree = [node, ...descendants(node)];
  for (const item of subtree) {
    if (item.kind === "page") {
      if (checked) pageIds.add(item.id);
      else pageIds.delete(item.id);
    } else if (checked) {
      explicitFolderIds.add(item.id);
    } else {
      explicitFolderIds.delete(item.id);
    }
  }
  return { pageIds, explicitFolderIds };
}

export type SetupCheckState = "checked" | "indeterminate" | "unchecked";

export function checkState(
  index: SetupCatalogIndex,
  state: SetupSelectionState,
  nodeId: string
): SetupCheckState {
  const node = index.byId.get(nodeId);
  if (!node) return "unchecked";
  if (node.kind === "page") return state.pageIds.has(nodeId) ? "checked" : "unchecked";

  const items = descendants(node);
  if (!items.length) {
    return state.explicitFolderIds.has(nodeId) ? "checked" : "unchecked";
  }
  const selected = items.filter((item) =>
    item.kind === "page" ? state.pageIds.has(item.id) : state.explicitFolderIds.has(item.id)
  );
  if (selected.length === items.length) return "checked";
  if (selected.length || state.explicitFolderIds.has(nodeId)) return "indeterminate";
  return "unchecked";
}

export interface SetupTreeFilter {
  query: string;
  areaId: string;
  referenceModel: string;
}

/** Keeps a node when it matches, or when one of its descendants does. */
export function filterTree(
  nodes: SetupTreeNode[],
  filter: SetupTreeFilter
): SetupTreeNode[] {
  const normalized = filter.query.trim().toLocaleLowerCase();
  const matches = (node: SetupTreeNode): boolean => {
    if (filter.areaId && node.areaId !== filter.areaId) return false;
    if (
      filter.referenceModel &&
      !node.referenceModels.includes(filter.referenceModel as SetupReferenceModel)
    ) {
      return false;
    }
    if (!normalized) return true;
    return (
      node.title.toLocaleLowerCase().includes(normalized) ||
      node.description.toLocaleLowerCase().includes(normalized)
    );
  };
  const walk = (list: SetupTreeNode[]): SetupTreeNode[] =>
    list
      .map((node) => ({ ...node, children: walk(node.children) }))
      .filter((node) => node.children.length > 0 || matches(node));
  return walk(nodes);
}

/** Node ids the recommender would pick, used for the STEP 2 comparison. */
export function estimateSelection(
  index: SetupCatalogIndex,
  size: ProjectSize,
  method: DevelopmentMethod,
  level: DocumentationLevel
): SetupResolvedSelection {
  const pageIds = new Set(
    index.catalog.pages
      .filter(
        (page) =>
          page.requiredness !== "optional" &&
          LEVEL_RANK[page.minimumLevel] <= LEVEL_RANK[level] &&
          page.sizes.includes(size) &&
          page.methods.includes(method)
      )
      .map((page) => page.id)
  );
  const pending = [...pageIds];
  while (pending.length) {
    const current = pending.pop()!;
    for (const dependency of index.pageById.get(current)?.dependencies ?? []) {
      if (pageIds.has(dependency)) continue;
      pageIds.add(dependency);
      pending.push(dependency);
    }
  }
  return resolveSelection(index, { pageIds, explicitFolderIds: new Set() });
}

/** Prunes the catalog down to the nodes a resolved selection will generate. */
export function selectedTree(
  nodes: SetupTreeNode[],
  selection: SetupResolvedSelection
): SetupTreeNode[] {
  return treeForIds(nodes, new Set([...selection.folderIds, ...selection.pageIds]));
}

/**
 * Prunes the catalog to an explicit id set. The review step uses this to keep a
 * row visible after it is unchecked, so the user can put it back.
 */
export function treeForIds(nodes: SetupTreeNode[], ids: Set<string>): SetupTreeNode[] {
  return nodes
    .filter((node) => ids.has(node.id))
    .map((node) => ({ ...node, children: treeForIds(node.children, ids) }));
}

/** Every id in a resolved selection, folders and pages together. */
export function selectionIds(selection: SetupResolvedSelection): Set<string> {
  return new Set([...selection.folderIds, ...selection.pageIds]);
}

export function countNodes(nodes: SetupTreeNode[]): { folders: number; pages: number } {
  return nodes.reduce(
    (total, node) => {
      const inner = countNodes(node.children);
      return {
        folders: total.folders + inner.folders + (node.kind === "folder" ? 1 : 0),
        pages: total.pages + inner.pages + (node.kind === "page" ? 1 : 0)
      };
    },
    { folders: 0, pages: 0 }
  );
}
