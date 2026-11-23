import { fromMarkdown } from "mdast-util-from-markdown";

/** Only image nodes count: examples in code and ordinary links are not assets. */
export function extractAssetReferences(markdown: string): string[] {
  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, string>();
  function definitionsIn(node: typeof tree | typeof tree.children[number]): void {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
    if ("children" in node) for (const child of node.children) definitionsIn(child as typeof tree.children[number]);
  }
  definitionsIn(tree);
  const references: string[] = [];
  function walk(node: typeof tree | typeof tree.children[number]): void {
    const url = node.type === "image" ? node.url
      : node.type === "imageReference" ? definitions.get(node.identifier) : undefined;
    if (url?.startsWith("asset:")) references.push(url.slice(6));
    if ("children" in node) for (const child of node.children) walk(child as typeof tree.children[number]);
  }
  walk(tree);
  return [...new Set(references)];
}

/** Paths are logical, slash-separated paths, never OS paths or URLs. */
export function isAssetPath(value: string): boolean {
  return !!value && !/[\\\x00-\x1f\x7f]/.test(value) &&
    !value.split("/").some((part) => !part || part === "." || part === "..") &&
    !/^[a-zA-Z]:/.test(value);
}
