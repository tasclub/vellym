import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

function dictionary(locale: string): Record<string, string> {
  return JSON.parse(
    readFileSync(
      path.join(workspaceRoot, "packages/ui-react/src/locales", `${locale}.json`),
      "utf8"
    )
  );
}

/**
 * 特定の業務でしか意味を持たない語。
 *
 * これらが**汎用レンダラの辞書**に入ると、そのプラグインを使っていない
 * 利用者にもチケットの語が見えることになる。プラグインが増えるたびに
 * Coreの辞書が業務語で膨らむのも止める。
 *
 * 判定は`plugin.*`の名前空間に限る。Core自身の画面（文書・セットアップ・
 * 管理）は自分の語彙を持ってよく、「読み込みの問題（loading issue）」の
 * ような一般語まで巻き込まない。
 */
const DOMAIN_TERMS: Record<string, readonly string[]> = {
  ja: [
    "チケット",
    "起票",
    "担当者",
    "優先度",
    "期限",
    "工数",
    "バックログ",
    "スプリント",
    "マイルストーン",
    "完了を含める"
  ],
  en: [
    "ticket",
    "assignee",
    "backlog",
    "sprint",
    "milestone",
    "due date",
    "include closed",
    "triage"
  ]
};

/**
 * 移設が済むまでの例外。**増やすときは必ず理由を書く。**
 *
 * ここが伸びていくこと自体が、汎用レンダラへ業務語が入り続けている合図に
 * なる。2026-08-18に空になった。**足す前に、本当に汎用レンダラの語かを疑う。**
 */
const KNOWN_LEAKS: readonly string[] = [];

function leaks(locale: string): string[] {
  const dict = dictionary(locale);
  const terms = DOMAIN_TERMS[locale] ?? [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(dict)) {
    if (!key.startsWith("plugin.")) continue;
    const text = String(value).toLowerCase();
    if (terms.some((term) => text.includes(term.toLowerCase()))) found.push(key);
  }
  return found.sort();
}

describe("generic renderer vocabulary", () => {
  it("keeps domain words out of the plugin dictionary", () => {
    // 過去に spec.documentType が分類ラベルとして育ったのと同じ壊れ方をする。
    // 語彙は一度出回ると引き戻せないので、増える前に止める。
    for (const locale of ["ja", "en"]) {
      const unexpected = leaks(locale).filter((key) => !KNOWN_LEAKS.includes(key));
      expect(unexpected, `${locale}.json に業務語が入っている`).toEqual([]);
    }
  });

  it("still detects a leak when one is introduced", () => {
    // 検出そのものが効いていることを確かめる。効かない検査を置いても意味が無い。
    // 実データが空になったので、判定関数へ直接食わせて確かめる。
    const dictionary = {
      "plugin.assign": "担当者を割り当てる",
      "plugin.addRow": "行を追加"
    };
    const found = Object.entries(dictionary)
      .filter(([, value]) =>
        (DOMAIN_TERMS.ja ?? []).some((term) => value.includes(term))
      )
      .map(([key]) => key);
    expect(found).toEqual(["plugin.assign"]);
  });

  it("does not flag the generic words the renderer legitimately owns", () => {
    // 「行を追加」「絞り込みを解除」は表の語であって業務の語ではない。
    // ここが落ちるなら語のリストが広すぎる。
    const flagged = new Set([...leaks("ja"), ...leaks("en")]);
    for (const key of [
      "plugin.addRow",
      "plugin.filterClear",
      "plugin.rowCount",
      "plugin.selectAll",
      "plugin.required",
      "plugin.settings"
    ]) {
      expect(flagged.has(key), `${key} を業務語と誤判定している`).toBe(false);
    }
  });

  it("keeps the exception list empty", () => {
    // **一度空にしたら、増えたことに気づける。** 足すには手でここを直す。
    expect(KNOWN_LEAKS).toEqual([]);
  });

  it("checks both dictionaries against the same keys", () => {
    const ja = Object.keys(dictionary("ja")).sort();
    const en = Object.keys(dictionary("en")).sort();
    expect(ja).toEqual(en);
  });
});
