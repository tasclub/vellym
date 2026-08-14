import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { Heading } from "mdast";
import type {
  FolderSummary,
  PageSummary,
  RichTextBlock
} from "./types.js";

export interface DocumentHeading {
  depth: number;
  id: string;
  text: string;
}

export interface DocumentNavigationPage extends PageSummary {
  breadcrumbs: string[];
  headings: DocumentHeading[];
  previous?: Pick<PageSummary, "name" | "slug" | "title">;
  next?: Pick<PageSummary, "name" | "slug" | "title">;
}

export interface DocumentNavigationFolder {
  kind: "folder";
  name: string;
  title: string;
  path: string;
  children: DocumentNavigationNode[];
}

export interface DocumentNavigationPageNode {
  kind: "page";
  name: string;
  slug: string;
  title: string;
  relativePath: string;
}

export type DocumentNavigationNode =
  | DocumentNavigationFolder
  | DocumentNavigationPageNode;

export interface DocumentNavigation {
  tree: DocumentNavigationNode[];
  pages: DocumentNavigationPage[];
}

function pathParts(relativePath: string): string[] {
  return relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
}

export function headingId(
  text: string,
  occurrences: Map<string, number>
): string {
  const base =
    text
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section";
  const occurrence = (occurrences.get(base) ?? 0) + 1;
  occurrences.set(base, occurrence);
  return occurrence === 1 ? base : `${base}-${occurrence}`;
}

export function extractDocumentHeadings(
  blocks: RichTextBlock[]
): DocumentHeading[] {
  const occurrences = new Map<string, number>();
  const headings: DocumentHeading[] = [];
  for (const block of blocks) {
    const tree = fromMarkdown(block.content);
    for (const node of tree.children) {
      if (node.type !== "heading") continue;
      const heading = node as Heading;
      const text = toString(heading);
      headings.push({
        depth: heading.depth,
        id: headingId(text, occurrences),
        text
      });
    }
  }
  return headings;
}

export function buildDocumentNavigation(
  summaries: PageSummary[],
  headingsByPage: ReadonlyMap<string, DocumentHeading[]> = new Map(),
  folderSummaries: FolderSummary[] = []
): DocumentNavigation {
  const root: DocumentNavigationNode[] = [];
  const folders = new Map<string, DocumentNavigationFolder>();
  const folderMetadata = new Map(
    folderSummaries.map((folder) => [folder.path, folder])
  );

  const ensureFolder = (folderPath: string): DocumentNavigationFolder => {
    const existing = folders.get(folderPath);
    if (existing) return existing;
    const parts = pathParts(folderPath);
    const name = parts.at(-1) ?? "";
    const parentPath = parts.slice(0, -1).join("/");
    const metadata = folderMetadata.get(folderPath);
    const folder: DocumentNavigationFolder = {
      kind: "folder",
      name,
      title: metadata?.title ?? name,
      path: folderPath,
      children: []
    };
    folders.set(folderPath, folder);
    const parentChildren = parentPath
      ? ensureFolder(parentPath).children
      : root;
    parentChildren.push(folder);
    return folder;
  };

  for (const folder of folderSummaries) {
    if (folder.path) ensureFolder(folder.path);
  }

  for (const page of summaries) {
    const parts = pathParts(page.relativePath);
    const directoryParts = parts.slice(0, -1);
    let children = root;
    let currentPath = "";
    for (const part of directoryParts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const folder = ensureFolder(currentPath);
      children = folder.children;
    }
    children.push({
      kind: "page",
      name: page.name,
      slug: page.slug ?? page.name,
      title: page.title,
      relativePath: page.relativePath
    });
  }

  const collator = new Intl.Collator("ja", {
    numeric: true,
    sensitivity: "base"
  });
  const sortChildren = (
    children: DocumentNavigationNode[],
    parentPath: string
  ) => {
    const order = folderMetadata.get(parentPath)?.order ?? [];
    const positions = new Map(order.map((name, index) => [name, index]));
    children.sort((left, right) => {
      const leftName =
        left.kind === "folder"
          ? left.name
          : pathParts(left.relativePath).at(-1)!;
      const rightName =
        right.kind === "folder"
          ? right.name
          : pathParts(right.relativePath).at(-1)!;
      const leftPosition = positions.get(leftName);
      const rightPosition = positions.get(rightName);
      if (leftPosition !== undefined || rightPosition !== undefined) {
        if (leftPosition === undefined) return 1;
        if (rightPosition === undefined) return -1;
        return leftPosition - rightPosition;
      }
      const byDisplayName = collator.compare(left.title, right.title);
      return byDisplayName || leftName.localeCompare(rightName);
    });
    for (const child of children) {
      if (child.kind === "folder") sortChildren(child.children, child.path);
    }
  };
  sortChildren(root, "");

  const orderedSummaries: PageSummary[] = [];
  const summariesByName = new Map(summaries.map((page) => [page.name, page]));
  const collectPages = (nodes: DocumentNavigationNode[]) => {
    for (const node of nodes) {
      if (node.kind === "folder") collectPages(node.children);
      else {
        const summary = summariesByName.get(node.name);
        if (summary) orderedSummaries.push(summary);
      }
    }
  };
  collectPages(root);
  const pageSequence =
    folderSummaries.length > 0 ? orderedSummaries : summaries;

  const pages = pageSequence.map((page, index) => ({
    ...page,
    breadcrumbs: pathParts(page.relativePath).slice(0, -1),
    headings: headingsByPage.get(page.name) ?? [],
    ...(index === 0
      ? {}
      : {
          previous: {
            name: pageSequence[index - 1]!.name,
            slug: pageSequence[index - 1]!.slug,
            title: pageSequence[index - 1]!.title
          }
        }),
    ...(index === pageSequence.length - 1
      ? {}
      : {
          next: {
            name: pageSequence[index + 1]!.name,
            slug: pageSequence[index + 1]!.slug,
            title: pageSequence[index + 1]!.title
          }
        })
  }));

  return { tree: root, pages };
}
