import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const clientRoot = path.join(process.cwd(), "packages/ui-react/dist/client");
const assets = path.join(clientRoot, "assets");

/**
 * import mapが指す固定名ファイルと、そこから読めなければならない名前。
 *
 * **ここが静かに壊れると、プラグイン側でhooksがundefinedになる形で初めて
 * 表面化する。** 実際に一度壊れた。Viteのアプリ向け既定は
 * `preserveEntrySignatures: false`で、Rollupがentryのexportを改名してよい
 * ことになっており、`useState`が`a`になって消えていた。
 */
const REQUIRED_EXPORTS: Record<string, readonly string[]> = {
  "vellym-react.js": ["useState", "useEffect", "useMemo", "useRef", "createElement"],
  "vellym-react-dom.js": ["createRoot", "createPortal"],
  "vellym-jsx-runtime.js": ["jsx", "jsxs", "Fragment"],
  "vellym-ui.js": ["Button", "Dialog", "DataTable", "FieldInput"]
};

const built = existsSync(path.join(clientRoot, "index.html"));

describe.skipIf(!built)("shared entries for plugins", () => {
  it("keeps the file names the import map points at", () => {
    // 名前が変わるとプラグインの読み込みが壊れる。ハッシュを付けない。
    for (const name of Object.keys(REQUIRED_EXPORTS)) {
      expect(existsSync(path.join(assets, name)), `${name} が無い`).toBe(true);
    }
  });

  it("really exports the names plugins import", async () => {
    for (const [name, expected] of Object.entries(REQUIRED_EXPORTS)) {
      const module = await import(path.join(assets, name));
      for (const key of expected) {
        expect(
          module[key],
          `${name} から ${key} が読めない`
        ).toBeDefined();
      }
    }
  });

  it("puts the import map before the first module script", () => {
    // documentに1つだけ、かつ最初のmodule読み込みより前でなければ効かない。
    const html = readFileSync(path.join(clientRoot, "index.html"), "utf8");
    const map = html.indexOf('type="importmap"');
    const firstModule = html.indexOf('type="module"');
    expect(map).toBeGreaterThan(-1);
    expect(firstModule).toBeGreaterThan(-1);
    expect(map).toBeLessThan(firstModule);
    expect(html.match(/type="importmap"/g)).toHaveLength(1);
  });

  it("points every bare specifier plugins may use at a fixed file", () => {
    const html = readFileSync(path.join(clientRoot, "index.html"), "utf8");
    const match = html.match(/<script type="importmap">(.*?)<\/script>/s);
    const imports = JSON.parse(match?.[1] ?? "{}").imports as Record<string, string>;
    expect(Object.keys(imports).sort()).toEqual([
      "@vellym/plugin-api/ui",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime"
    ]);
    // 相対値にする。document baseを起点に解決されるので、静的版を任意の
    // サブパスへ置いても壊れない。**外部URLを指さない。**
    for (const target of Object.values(imports)) {
      expect(target.startsWith("./assets/"), `${target} が相対でない`).toBe(true);
      expect(existsSync(path.join(clientRoot, target))).toBe(true);
    }
  });
});

describe("the SPA shell served by the dev server", () => {
  it("pins the import map to the serving root", async () => {
    // 静的版は相対のままでよい（任意のサブパスへ置ける）。しかし動的版は
    // 深いURL（/ja/pages/<slug>）で配られるため、相対のままだと
    // /ja/pages/assets/... へ解決され、**プラグインからのReactの読み込みだけ**が
    // 静かに404になる。属性ではなくscriptの本文にあるので、href/srcの置換では
    // 拾えない。実際に一度そうなった。
    const { dynamicIndexHtml } = await import("@vellym-internal/runtime-node");
    const html = [
      '<script type="importmap">',
      '{"imports":{"react":"./assets/vellym-react.js"}}',
      "</script>",
      '<script type="module" src="./assets/index-abc.js"></script>'
    ].join("");
    const rewritten = dynamicIndexHtml(Buffer.from(html, "utf8")).toString("utf8");
    expect(rewritten).toContain('"react":"/assets/vellym-react.js"');
    expect(rewritten).toContain('src="/assets/index-abc.js"');
    expect(rewritten).not.toContain('"./assets/vellym-');
  });
});
