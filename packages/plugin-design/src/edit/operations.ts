import type { DesignNode } from "../model/types.js";

/** A board's place on the canvas (`DesignBoard.spec.x`/`y`), outside the node tree. */
export interface BoardPosition { x: number; y: number }
/** One committed gesture can change roots in several resources atomically in memory. */
export interface RootChange {
  targetName: string;
  field?: "root";
  before: DesignNode;
  after: DesignNode;
}
export interface PositionChange {
  targetName: string;
  field: "position";
  before: BoardPosition;
  after: BoardPosition;
}
export type DesignChange = RootChange | PositionChange;
export interface DesignOperation {
  changes: DesignChange[];
  /** Only repeated nudges use a key. Drags and input commits are separate operations. */
  mergeKey?: string;
}
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const fieldOf = (change: DesignChange) => change.field ?? "root";

export function mergeOperations(first: DesignOperation, last: DesignOperation): DesignOperation | undefined {
  if (!first.mergeKey || first.mergeKey !== last.mergeKey ||
      first.changes.length !== last.changes.length) return;
  const changes = first.changes.map(change => {
    const next = last.changes.find(row => row.targetName === change.targetName && fieldOf(row) === fieldOf(change));
    return next && sameValue(change.after, next.before) ? { ...change, after: next.after } as DesignChange : undefined;
  });
  if (changes.some(change => !change)) return;
  return { mergeKey: first.mergeKey, changes: changes as DesignChange[] };
}
