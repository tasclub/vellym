import type { BooleanNode } from "../model/types.js";
import type { VectorPath } from "./vector.js";

export type BooleanOperation = BooleanNode["operation"];
/** Child paths must be resolved into the boolean parent's coordinate system.
 * An SVG matrix can carry the child's translation, rotation and scale.
 */
export interface BooleanChild extends Pick<VectorPath, "d"> {
  fillRule?: VectorPath["fillRule"];
  transform?: readonly [number, number, number, number, number, number];
}

let paperModule: Promise<typeof import("paper")> | undefined;
function loadPaper(): Promise<typeof import("paper")> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Boolean geometry is only available in the browser"));
  }
  // No PaperScope, DOM, canvas, or dependency evaluation at module import time.
  paperModule ??= import("paper").then(module => module.default).catch(error => {
    paperModule = undefined;
    throw error;
  });
  return paperModule;
}

function hash(content: string): string {
  let value = 2166136261;
  for (let i = 0; i < content.length; i++) value = Math.imul(value ^ content.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16);
}

async function calculate(operation: BooleanOperation, children: readonly BooleanChild[]): Promise<string> {
  if (!children.length) return "";
  const paper = await loadPaper();
  const scope = new paper.PaperScope();
  // Size-only setup creates a project without creating / drawing a canvas.
  scope.setup(new scope.Size(1, 1));
  try {
    const paths = children.map(child => {
      const path = new scope.CompoundPath({ pathData: child.d, insert: false });
      path.fillRule = child.fillRule ?? "nonzero";
      if (child.transform) path.transform(new scope.Matrix(...child.transform));
      return path;
    });
    let result: paper.PathItem = paths[0]!;
    const method = { union: "unite", subtract: "subtract", intersect: "intersect", exclude: "exclude" } as const;
    for (const child of paths.slice(1)) {
      result = result[method[operation]](child, { insert: false });
    }
    return result.pathData;
  } finally {
    scope.remove();
  }
}

/** One cache per canvas (IDs are only unique within a board, so use a board/ID
 * key). Keeps only the latest geometry per node, including in-flight work.
 */
export function createBooleanPathRenderer() {
  const cache = new Map<string, { hash: string; content: string; result: Promise<string> }>();
  return {
    render(id: string, operation: BooleanOperation, children: readonly BooleanChild[]): Promise<string> {
      // Canonical geometry-only snapshot: caller mutations during import cannot
      // change the calculation, and optional/default fill rules share a key.
      const snapshot = children.map(child => ({
        d: child.d, fillRule: child.fillRule ?? "nonzero", transform: child.transform ? [...child.transform] as BooleanChild["transform"] : undefined
      }));
      const content = JSON.stringify([operation, snapshot]);
      const key = hash(content);
      const previous = cache.get(id);
      // Compare content too: hash collisions must never serve stale geometry.
      if (previous?.hash === key && previous.content === content) return previous.result;
      const result = calculate(operation, snapshot);
      const entry = { hash: key, content, result };
      cache.set(id, entry);
      void result.catch(() => {
        if (cache.get(id) === entry) cache.delete(id);
      });
      return result;
    },
    /** Release deleted nodes, or all entries when closing the canvas. */
    clear(id?: string): void {
      if (id === undefined) cache.clear();
      else cache.delete(id);
    }
  };
}
