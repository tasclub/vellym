export interface DiffLine { kind: "context" | "add" | "remove"; text: string; old?: number; next?: number }

/** Parse only hunk bodies: file headers and Git metadata are not document lines. */
export function parseGitDiff(source: string): DiffLine[] {
  const result: DiffLine[] = [];
  let old = 0, next = 0, inHunk = false;
  for (const line of source.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith("+")) result.push({ kind: "add", text: line.slice(1), next: next++ });
    else if (line.startsWith("-")) result.push({ kind: "remove", text: line.slice(1), old: old++ });
    else if (line.startsWith(" ")) result.push({ kind: "context", text: line.slice(1), old: old++, next: next++ });
  }
  return result;
}

export type DiffChunk = { start: number; lines: DiffLine[]; folded: boolean };
export function foldDiff(lines: DiffLine[]): DiffChunk[] {
  const visible = lines.map((line, i) => line.kind !== "context" ||
    lines.slice(Math.max(0, i - 3), i + 4).some((near) => near.kind !== "context"));
  const chunks: DiffChunk[] = [];
  for (let i = 0; i < lines.length;) {
    const start = i, folded = !visible[i];
    while (i < lines.length && !visible[i] === folded) i++;
    chunks.push({ start, lines: lines.slice(start, i), folded });
  }
  return chunks;
}
