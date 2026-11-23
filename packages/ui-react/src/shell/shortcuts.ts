import { createContext, useContext, useEffect, useRef } from "react";

/**
 * Default keyboard shortcuts (ticket-01m7k6gftpkx2b781dtxtgfxtx). The table lives here only;
 * the shortcut list dialog and the user guide are checked against it.
 *
 * `Mod` is Cmd on macOS and Ctrl elsewhere. Avoided on purpose: Mod+1–9 and Alt+1–9 (tabs),
 * Alt+arrows (history), Mod+B/I/U/Z (editor), Mod+F/P/W/T/N (browser), and Esc (closes dialogs).
 */
export type ShortcutId = "search" | "save" | "edit" | "toggleTree" | "previousView" | "nextView" | "help";

export interface ShortcutDefinition {
  id: ShortcutId;
  keys: readonly string[];
  /**
   * Whether it also works while typing in a field or the editor: every key, none, or only
   * the listed keys (search keeps `/` as a typed character but takes Mod+K).
   */
  inInput: boolean | readonly string[];
  /** Dictionary keys for the action and where it works. */
  label: string;
  scope: string;
}

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { id: "search", keys: ["/", "Mod+K"], inInput: ["Mod+K"], label: "shortcuts.search", scope: "shortcuts.scopeAnywhere" },
  { id: "save", keys: ["Mod+S"], inInput: true, label: "shortcuts.save", scope: "shortcuts.scopeEditing" },
  { id: "edit", keys: ["E"], inInput: false, label: "shortcuts.edit", scope: "shortcuts.scopeReading" },
  { id: "toggleTree", keys: ["Mod+\\"], inInput: true, label: "shortcuts.toggleTree", scope: "shortcuts.scopeDocuments" },
  { id: "previousView", keys: ["["], inInput: false, label: "shortcuts.previousView", scope: "shortcuts.scopeViews" },
  { id: "nextView", keys: ["]"], inInput: false, label: "shortcuts.nextView", scope: "shortcuts.scopeViews" },
  { id: "help", keys: ["?"], inInput: false, label: "shortcuts.help", scope: "shortcuts.scopeAnywhere" }
];

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform ?? "";
  return /mac|iphone|ipad/i.test(platform);
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function matchesKey(event: KeyboardEvent, key: string, isMac: boolean): boolean {
  const parts = key.split("+");
  const main = parts.pop()!;
  const mod = parts.includes("Mod");
  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  const otherMod = isMac ? event.ctrlKey : event.metaKey;
  if (mod !== modPressed || otherMod || event.altKey) return false;
  if (main.length === 1 && /[a-z]/i.test(main)) {
    // Letters: no Shift, case-insensitive (a held Shift means a different character).
    return !event.shiftKey && event.key.toLowerCase() === main.toLowerCase();
  }
  // Symbols (`/`, `?`, `[`, `]`, `\`) compare by the produced character, whatever Shift took.
  return event.key === main;
}

/** The shortcut this key press means, or undefined. Never matches during IME composition. */
export function matchShortcut(event: KeyboardEvent, isMac: boolean): ShortcutId | undefined {
  if (event.isComposing || event.keyCode === 229) return undefined;
  const typing = isTyping(event.target);
  for (const shortcut of SHORTCUTS) {
    const keys = !typing || shortcut.inInput === true ? shortcut.keys
      : shortcut.inInput === false ? [] : shortcut.inInput;
    if (keys.some((key) => matchesKey(event, key, isMac))) return shortcut.id;
  }
  return undefined;
}

/** Keys for display: ⌘K on macOS, Ctrl+K elsewhere. */
export function formatKeys(keys: readonly string[], isMac: boolean): string[] {
  return keys.map((key) => isMac ? key.replace("Mod+", "⌘") : key.replace("Mod+", "Ctrl+"));
}

type Handler = () => void;
interface ShortcutRegistry {
  register(id: ShortcutId, handler: Handler): () => void;
  openHelp(): void;
}

export const ShortcutContext = createContext<ShortcutRegistry | undefined>(undefined);

/** Lets the screen on display handle a shortcut (save, edit, view switching) while mounted. */
export function useShortcutAction(id: ShortcutId, handler: Handler | undefined): void {
  const registry = useContext(ShortcutContext);
  const latest = useRef(handler);
  latest.current = handler;
  const active = handler !== undefined;
  useEffect(() => {
    if (!registry || !active) return;
    return registry.register(id, () => latest.current?.());
  }, [registry, id, active]);
}

export function useOpenShortcutHelp(): (() => void) | undefined {
  return useContext(ShortcutContext)?.openHelp;
}
