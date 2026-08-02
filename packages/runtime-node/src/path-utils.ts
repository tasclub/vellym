import { createHash } from "node:crypto";
import path from "node:path";

export function contentHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
