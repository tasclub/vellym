export function slugOf(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40);
}

function suffix(): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)),
    (byte) => alphabet[byte % 32]).join("");
}

export function canvasResourceName(title: string): string {
  return `${slugOf(title) || "design-canvas"}-${suffix()}`;
}
export function childResourceName(canvas: string, kind: "board" | "component"): string {
  return `${slugOf(canvas) || "design"}-${kind}-${suffix()}`;
}
export function boardResourceName(canvas: string): string {
  return childResourceName(canvas, "board");
}
export function folderOf(relativePath: string): string {
  return relativePath.slice(0, Math.max(0, relativePath.lastIndexOf("/")));
}
