import { readFileSync } from "node:fs";
import path from "node:path";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const uiRoot = path.join(process.cwd(), "packages/ui-react/src");

function componentFiles(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(uiRoot, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
    found.push(path.join(entry.parentPath, entry.name));
  }
  return found.sort();
}

/** 関数本体の直下（2字下げ）にあるhook呼び出し */
const HOOK_CALL = /^ {2}(?:const\s.*=\s*)?use[A-Z]\w*\(/;
/**
 * 関数本体の直下にある早期return。
 *
 * **入れ子のcallbackの`return`を拾わない。** 2字下げの`if`が返す形だけを
 * 早期returnとみなす。`useEffect`の中の`return`まで拾うと、まともな
 * コードが軒並み違反になる（最初の実装がそうだった）。
 */
function isEarlyReturn(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  // 1行形式: `  if (...) return ...;`
  if (/^ {2}if \(.*\)\s*return\b/.test(line)) return true;
  // ブロック形式: `  if (...) {` の直後3行以内に4字下げの return がある
  if (!/^ {2}if \(.*\)\s*\{\s*$/.test(line)) return false;
  return lines
    .slice(index + 1, index + 4)
    .some((next) => /^ {4}return\b/.test(next));
}

/**
 * hookが早期returnより後ろにあるファイルを探す。
 *
 * **Reactはhookの呼び出し回数が描画ごとに変わると壊れる**（error #310）。
 * 型はこれを捕まえない。eslintのreact-hooksも入っていない。実際に
 * `app.tsx`へ`useMemo`を早期returnの後ろへ足して踏んだので、機械で止める。
 */
function hooksAfterEarlyReturn(file: string): string[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const offenders: string[] = [];
  let sawEarlyReturn = false;
  for (const [index, line] of lines.entries()) {
    // 関数の切り替わりで状態を戻す。1ファイルに複数の部品がある
    if (/^(?:export )?function [A-Z]/.test(line)) {
      sawEarlyReturn = false;
    }
    if (isEarlyReturn(lines, index)) sawEarlyReturn = true;
    if (sawEarlyReturn && HOOK_CALL.test(line)) {
      offenders.push(`${path.relative(process.cwd(), file)}:${index + 1} ${line.trim()}`);
    }
  }
  return offenders;
}

describe("hook order", () => {
  it("never calls a hook after an early return", () => {
    const offenders = componentFiles().flatMap(hooksAfterEarlyReturn);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("actually detects the shape it is looking for", () => {
    // 検出が効いていることを確かめる。効かない検査を置いても意味が無い。
    const sample = [
      "export function Broken() {",
      "  if (!ready) {",
      "    return null;",
      "  }",
      "  const value = useMemo(() => 1, []);",
      "  return value;",
      "}"
    ].join("\n");
    const temporary = path.join(process.cwd(), "packages/ui-react/src/.hook-probe.tsx");
    try {
      require("node:fs").writeFileSync(temporary, sample, "utf8");
      expect(hooksAfterEarlyReturn(temporary)).toHaveLength(1);
    } finally {
      require("node:fs").rmSync(temporary, { force: true });
    }
  });
});
