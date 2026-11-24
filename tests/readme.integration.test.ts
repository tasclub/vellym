import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const rootReadmes = [
  "README.md",
  "packages/vellym/README.md",
  "packages/plugin-api/README.md",
  "packages/plugin-tickets/README.md",
  "packages/plugin-kanban/README.md",
  "packages/plugin-wbs/README.md"
];

type HeadingPair = readonly [level: number, english: string, japanese: string];

const headingPairs: Record<string, readonly HeadingPair[]> = {
  "README.md": [
    [2, "Quick start", "クイックスタート"],
    [2, "Commands", "コマンド"],
    [2, "Canonical YAML example", "正本の形（例）"],
    [2, "Plugins", "プラグイン"],
    [2, "Development", "開発"],
    [3, "Dev Container", "Dev Container"],
    [3, "Runtime image candidate", "配布候補 runtime イメージ"],
    [2, "Status", "ステータス"],
    [2, "License", "ライセンス"],
    [2, "Community and support", "開発参加・サポート"]
  ],
  "packages/vellym/README.md": [
    [2, "Quick start", "クイックスタート"],
    [2, "Commands", "コマンド"],
    [2, "Canonical YAML example", "正本の形（例）"],
    [2, "Plugins", "プラグイン"],
    [2, "Status", "ステータス"],
    [2, "License", "ライセンス"],
    [2, "Community and support", "開発参加・サポート"]
  ],
  "packages/plugin-api/README.md": [
    [2, "Installing", "インストール"],
    [2, "Writing the Node entry", "Nodeエントリを書く"],
    [2, "Rules the host enforces", "ホストが適用するルール"],
    [2, "Naming", "命名"],
    [2, "License", "ライセンス"]
  ],
  "packages/plugin-tickets/README.md": [
    [2, "Installing", "インストール"],
    [2, "Configuration", "設定"],
    [2, "Where to put ticket management", "チケット管理を置く場所"],
    [2, "Statuses and fields", "ステータスと項目"],
    [2, "Writing YAML directly", "YAMLで直接書く"],
    [3, "TicketTracker", "TicketTracker"],
    [3, "Ticket", "Ticket"],
    [3, "Field types and values", "項目の型と値の書き方"],
    [2, "Removing the plugin", "プラグインを外す"],
    [2, "License", "ライセンス"]
  ],
  "packages/plugin-kanban/README.md": [],
  "packages/plugin-wbs/README.md": []
};

const cliPath = path.resolve("packages/vellym/dist/cli.mjs");
const supportedCommands = ["init", "dev", "validate", "build", "migrate"] as const;

function section(markdown: string, language: "English" | "日本語"): string {
  const sections = [...markdown.matchAll(/^## (English|日本語)\s*$/gm)];
  const current = sections.find((match) => match[1] === language);
  if (!current || current.index === undefined) return "";
  const start = current.index;
  const next = sections.find((match) => (match.index ?? -1) > start);
  return markdown.slice(start + current[0]!.length, next?.index ?? markdown.length);
}

function headings(markdown: string): Array<{ level: number; title: string }> {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  return [...withoutCode.matchAll(/^(#{2,6})\s+(.+?)\s*#*\s*$/gm)].map((match) => ({
    level: match[1]!.length,
    title: match[2]!
  }));
}

function readCliHelp(args: string[]): string {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe("published README entry points", () => {
  it.each(rootReadmes)("provides matching English and Japanese sections in %s", (file) => {
    const markdown = readFileSync(path.resolve(file), "utf8");
    const english = section(markdown, "English");
    const japanese = section(markdown, "日本語");

    expect(markdown.match(/^## English\s*$/gm)).toHaveLength(1);
    expect(markdown.match(/^## 日本語\s*$/gm)).toHaveLength(1);
    expect(markdown).toMatch(/^\[English\]\(#english\) \| \[日本語\]\(#日本語\)$/m);
    expect(english).toContain("https://vellym.tasclub.com/en/");
    expect(japanese).toContain("https://vellym.tasclub.com/");

    const expected = headingPairs[file]!.map(([level, en]) => ({ level, title: en }));
    const translated = headingPairs[file]!.map(([level, _en, ja]) => ({ level, title: ja }));
    expect(headings(english)).toEqual(expected);
    expect(headings(japanese)).toEqual(translated);
  });

  it.each(["README.md", "packages/vellym/README.md"])("shows the same screenshots in both languages of %s, from absolute URLs", (file) => {
    // ticket-01m6sy03482dah0pzpqvmgx7b5: npm cannot show relative images, and the images are not packed.
    const markdown = readFileSync(file, "utf8");
    const images = (text: string) => [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
    const english = images(section(markdown, "English"));
    expect(english.length).toBeGreaterThanOrEqual(4);
    expect(images(section(markdown, "日本語"))).toEqual(english);
    for (const url of english) expect(url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/tasclub\/vellym\/main\/\.github\/readme\/[a-z-]+\.(png|jpg)$/);
    expect(section(markdown, "English")).toContain("https://vellym.tasclub.com/en/pages/demo-tickets/");
    expect(section(markdown, "日本語")).toContain("https://vellym.tasclub.com/pages/demo-tickets/");
  });

  it("uses only CLI commands and options present in the built --help", () => {
    const globalHelp = readCliHelp(["--help"]);
    const availableCommands = new Set(
      [...globalHelp.matchAll(/^\s*vellym\s+(init|dev|validate|build|migrate)\b/gm)].map(
        (match) => match[1]
      )
    );
    const commandHelp = new Map(
      supportedCommands.map((command) => [command, readCliHelp([command, "--help"])] as const)
    );

    for (const file of rootReadmes) {
      const markdown = readFileSync(path.resolve(file), "utf8");
      const invocations = markdown.matchAll(
        /(?:npx\s+)?vellym(?:@[\w.-]+)?\s+(init|dev|validate|build|migrate)\b([^`\n]*)/g
      );
      for (const invocation of invocations) {
        const command = invocation[1]! as (typeof supportedCommands)[number];
        const argumentsText = invocation[2]!;
        expect(availableCommands.has(command), `${file}: ${command}`).toBe(true);
        const help = commandHelp.get(command)!;
        for (const [, option] of argumentsText.matchAll(/(--[a-z][a-z0-9-]*)\b/g)) {
          expect(help, `${file}: ${command} ${option}`).toContain(option);
        }
      }
    }
  });
});
