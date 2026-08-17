import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const contractDist = path.join(root, "packages/ui-contract/dist");
const sharedIndex = path.join(root, "packages/ui-react/src/shared/index.ts");

function packageJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8"));
}

/** `export { A, type B } from "./x.js"` から名前を取り出す */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names.sort();
}

const built = existsSync(path.join(contractDist, "index.d.ts"));

describe("@vellym/ui", () => {
  it("ships types only. the implementation stays in the host", () => {
    // 実装を同梱すると部品が二重になり、Reactのインスタンスも分かれて
    // hooksが壊れる。実体はimport mapが`/assets/vellym-ui.js`へ向ける。
    const manifest = packageJson("packages/ui-contract/package.json");
    expect(manifest.name).toBe("@vellym/ui");
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.peerDependencies).toEqual({ react: ">=18" });
    // scoped packageは既定が非公開なので明示が要る
    expect((manifest.publishConfig as { access?: string }).access).toBe("public");
  });

  it("fails loudly if a plugin forgets to mark it external", () => {
    const runtime = readFileSync(
      path.join(root, "packages/ui-contract/src/runtime.ts"),
      "utf8"
    );
    expect(runtime).toContain("throw new Error");
    expect(runtime).toContain("external");
  });

  it.skipIf(!built)("declares exactly what the host implements", () => {
    /*
     * **宣言は実装から生成する。手で書かない。**
     *
     * 手で書くと、Coreがpropsを変えたときに宣言だけ古いまま残る。
     * ここでは生成物が実装の公開面と一致していることを確かめる。
     * ずれていたら生成が走っていない。
     */
    const declared = exportedNames(readFileSync(path.join(contractDist, "index.d.ts"), "utf8"));
    const implemented = exportedNames(readFileSync(sharedIndex, "utf8"));
    expect(declared).toEqual(implemented);
  });

  it.skipIf(!built)("lets plugins pass through their own attributes", () => {
    /*
     * プラグインが任意の属性を足せること。**宣言した props だけに縛らない。**
     * `Button`がHTMLの属性を素通しするので、`aria-*`や`data-*`を自由に置ける。
     */
    const button = readFileSync(path.join(contractDist, "button.d.ts"), "utf8");
    expect(button).toContain("ButtonHTMLAttributes");
    // 表は中身をコールバックで受ける。見せ方はプラグインが決める
    const table = readFileSync(path.join(contractDist, "table.d.ts"), "utf8");
    expect(table).toMatch(/cell\(/);
  });

  it("does not leak generated declarations into any source tree", () => {
    /*
     * 生成の設定を誤ると、**全パッケージのsrcへ宣言ファイルを書き出す。**
     * 実際に95ファイル書き出してしまった。コミット直前に気づいた。
     *
     * `css.d.ts`だけは手で書いたambient宣言なので正当である。
     */
    const strays: string[] = [];
    // **`packages/`だけでなく`tests/`も見る。** 実際に両方へ書き出した。
    for (const base of ["packages", "tests"]) {
      const from = path.join(root, base);
      for (const entry of readdirSync(from, { withFileTypes: true, recursive: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".d.ts")) continue;
        const full = path.join(entry.parentPath, entry.name);
        if (base === "packages" && !full.includes(`${path.sep}src${path.sep}`)) continue;
        if (entry.name === "css.d.ts") continue;
        strays.push(path.relative(root, full));
      }
    }
    expect(strays, strays.join("\n")).toEqual([]);
  });
});
