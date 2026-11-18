// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { SHORTCUTS, formatKeys, matchShortcut } from "../packages/ui-react/src/shell/shortcuts.js";
import ja from "../packages/ui-react/src/locales/ja.json" with { type: "json" };
import en from "../packages/ui-react/src/locales/en.json" with { type: "json" };

// ticket-01m7k6gftpkx2b781dtxtgfxtx
const key = (init: KeyboardEventInit, target?: EventTarget) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
  if (target) Object.defineProperty(event, "target", { value: target });
  return event;
};

describe("default keyboard shortcuts", () => {
  it("matches the table on Windows/Linux and Mac", () => {
    expect(matchShortcut(key({ key: "k", ctrlKey: true }), false)).toBe("search");
    expect(matchShortcut(key({ key: "k", metaKey: true }), true)).toBe("search");
    expect(matchShortcut(key({ key: "k", metaKey: true }), false)).toBeUndefined();
    expect(matchShortcut(key({ key: "/" }), false)).toBe("search");
    expect(matchShortcut(key({ key: "s", ctrlKey: true }), false)).toBe("save");
    expect(matchShortcut(key({ key: "e" }), false)).toBe("edit");
    expect(matchShortcut(key({ key: "E", shiftKey: true }), false)).toBeUndefined();
    expect(matchShortcut(key({ key: "\\", ctrlKey: true }), false)).toBe("toggleTree");
    expect(matchShortcut(key({ key: "[" }), false)).toBe("previousView");
    expect(matchShortcut(key({ key: "]" }), false)).toBe("nextView");
    expect(matchShortcut(key({ key: "?", shiftKey: true }), false)).toBe("help");
    expect(matchShortcut(key({ key: "1", ctrlKey: true }), false)).toBeUndefined();
    expect(matchShortcut(key({ key: "s", ctrlKey: true, altKey: true }), false)).toBeUndefined();
  });

  it("leaves typing alone except for the in-input shortcuts, and ignores IME composition", () => {
    const input = document.createElement("input");
    expect(matchShortcut(key({ key: "e" }, input), false)).toBeUndefined();
    expect(matchShortcut(key({ key: "/" }, input), false)).toBeUndefined();
    expect(matchShortcut(key({ key: "?" }, input), false)).toBeUndefined();
    expect(matchShortcut(key({ key: "s", ctrlKey: true }, input), false)).toBe("save");
    expect(matchShortcut(key({ key: "k", ctrlKey: true }, input), false)).toBe("search");
    expect(matchShortcut(key({ key: "e", isComposing: true }), false)).toBeUndefined();
    expect(matchShortcut(key({ key: "Process", keyCode: 229 }), false)).toBeUndefined();
  });

  it("formats keys for each platform", () => {
    expect(formatKeys(["/", "Mod+K"], false)).toEqual(["/", "Ctrl+K"]);
    expect(formatKeys(["Mod+K"], true)).toEqual(["⌘K"]);
  });

  it("has every label in both dictionaries", () => {
    for (const shortcut of SHORTCUTS) {
      for (const dictionary of [ja, en] as Array<Record<string, string>>) {
        expect(dictionary[shortcut.label]).toBeTruthy();
        expect(dictionary[shortcut.scope]).toBeTruthy();
      }
    }
  });

  it("matches the keys in the user guide tables (ja and en)", () => {
    const guide = YAML.parse(readFileSync("how-to-use/content/browser-guide.yaml", "utf8"));
    const bodies = [guide.spec.blocks[0].content as string, guide.spec.translations.en.blocks[0].content as string];
    for (const [index, body] of bodies.entries()) {
      const dictionary = (index === 0 ? ja : en) as Record<string, string>;
      for (const shortcut of SHORTCUTS) {
        const row = body.split("\n").find((line) => line.startsWith(`| ${dictionary[shortcut.label]} |`));
        expect(row, `${shortcut.id} row`).toBeTruthy();
        const keys = [...row!.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
        expect(keys).toEqual(formatKeys(shortcut.keys, false));
      }
    }
  });
});
