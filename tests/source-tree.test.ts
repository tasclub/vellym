import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

/**
 * **ビルド成果物をsrcへ置かない。**
 *
 * `import "./field-input.js"`は、隣に`field-input.js`が実在すればそれを読む。
 * `.tsx`は読まれない。TypeScriptの型検査だけは`.js`→`.tsx`へ読み替えるため、
 * typecheckもテストも緑のまま、動いているのは古いコンパイル済みコード、
 * という食い違いが起きる。実際に`packages/ui-react/src/shared/`へ
 * `tsc`の出力が21ファイル入り込み、共通部品の修正が効かない状態になっていた。
 *
 * 拡張子で機械的に落とす。人が気づける類の混入ではない。
 */
const ARTIFACT = /\.(js|jsx|js\.map|d\.ts|d\.ts\.map)$/;

/** 型宣言そのものが目的のファイル。CSS Modulesの`import`を型付けする */
const ALLOWED = new Set(["css.d.ts"]);

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      found.push(...walk(full));
      continue;
    }
    if (ALLOWED.has(entry.name)) continue;
    if (ARTIFACT.test(entry.name)) found.push(path.relative(workspaceRoot, full));
  }
  return found;
}

describe("packages/*/src", () => {
  it("holds no compiled output that would shadow the sources", () => {
    const packages = readdirSync(path.join(workspaceRoot, "packages"), {
      withFileTypes: true
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(workspaceRoot, "packages", entry.name, "src"))
      .filter((dir) => {
        try {
          readdirSync(dir);
          return true;
        } catch {
          return false;
        }
      });
    expect(packages.flatMap(walk)).toEqual([]);
  });
});
