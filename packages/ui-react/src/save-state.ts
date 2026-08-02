import type { RichTextBlock } from "@vellym-internal/core";

export type SaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "success"
  | "failure"
  | "conflict";

export type WatchState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface WatchConnection {
  state: WatchState;
  lastConfirmedAt?: number;
}

export interface RepositoryEvent {
  version: number;
  kind: string;
  watcher: "connecting" | "connected" | "error";
}

export function sameDraft(
  left: { title: string; slug?: string; blocks: RichTextBlock[] },
  right: { title: string; slug?: string; blocks: RichTextBlock[] }
): boolean {
  return (
    left.title === right.title &&
    left.slug === right.slug &&
    left.blocks.length === right.blocks.length &&
    left.blocks.every((block, index) => {
      const compared = right.blocks[index];
      return Boolean(
        compared &&
        block.id === compared.id &&
        block.content === compared.content
      );
    })
  );
}

export function draftCopyText(
  title: string,
  blocks: RichTextBlock[]
): string {
  const contents = blocks
    .map((block) => block.content.trim())
    .filter(Boolean);
  return [`# ${title.trim()}`, ...contents].join("\n\n").trimEnd() + "\n";
}

export function parseRepositoryEvent(value: string): RepositoryEvent | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.version !== "number" ||
      typeof parsed.kind !== "string" ||
      (parsed.watcher !== "connecting" &&
        parsed.watcher !== "connected" &&
        parsed.watcher !== "error")
    ) {
      return undefined;
    }
    return {
      version: parsed.version,
      kind: parsed.kind,
      watcher: parsed.watcher
    };
  } catch {
    return undefined;
  }
}
