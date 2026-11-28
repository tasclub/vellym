import type { DesignNode } from "../model/types.js";

/** One committed gesture can change roots in several resources atomically in memory. */
export interface RootChange {
  targetName: string;
  before: DesignNode;
  after: DesignNode;
}
export interface DesignOperation {
  changes: RootChange[];
  /** Only repeated nudges use a key. Drags and input commits are separate operations. */
  mergeKey?: string;
}
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeOperations(first: DesignOperation, last: DesignOperation): DesignOperation | undefined {
  if (!first.mergeKey || first.mergeKey !== last.mergeKey ||
      first.changes.length !== last.changes.length) return;
  const changes = first.changes.map(change => {
    const next = last.changes.find(row => row.targetName === change.targetName);
    return next && sameValue(change.after, next.before) ? { ...change, after: next.after } : undefined;
  });
  if (changes.some(change => !change)) return;
  return { mergeKey: first.mergeKey, changes: changes as RootChange[] };
}
