import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const clientRoot = path.join(process.cwd(), "packages/ui-react/dist/client");
const assets = path.join(clientRoot, "assets");

/**
 * import mapが指すエントリから読めなければならない名前。
 *
 * **ここが静かに壊れると、プラグイン側でhooksがundefinedになる形で初めて
 * 表面化する。** 実際に一度壊れた。Viteのアプリ向け既定は
 * `preserveEntrySignatures: false`で、Rollupがentryのexportを改名してよい
 * ことになっており、`useState`が`a`になって消えていた。
 */
const REQUIRED_EXPORTS: Record<string, readonly string[]> = {
  "react": ["useState", "useEffect", "useMemo", "useRef", "createElement"],
  "react-dom/client": ["createRoot", "createPortal"],
  "react/jsx-runtime": ["jsx", "jsxs", "Fragment"],
  "@vellym/plugin-api/ui": ["Button", "Dialog", "DataTable", "FieldInput", "ChoiceControl", "InputControl", "Icon", "KindIcon"],
  "@vellym/plugin-api": ["defineBrowserPlugin", "resolveLocalizedText"],
  "@vellym/plugin-api/react": ["reactRenderer"]
};

const built = existsSync(path.join(clientRoot, "index.html"));
function importsFromHtml(): Record<string, string> {
  const html = readFileSync(path.join(clientRoot, "index.html"), "utf8");
  const match = html.match(/<script type="importmap">(.*?)<\/script>/s);
  return JSON.parse(match?.[1] ?? "{}").imports;
}

describe.skipIf(!built)("shared entries for plugins", () => {
  it("points at existing hashed entries without fixed-name files", () => {
    const imports = importsFromHtml();
    for (const name of ["vellym-react", "vellym-react-dom", "vellym-jsx-runtime", "vellym-ui", "vellym-plugin-api", "vellym-plugin-api-react"]) {
      expect(existsSync(path.join(assets, `${name}.js`))).toBe(false);
      expect(Object.values(imports).some((url) => new RegExp(`^\\./assets/${name}-[\\w-]+\\.js$`).test(url))).toBe(true);
    }
    for (const url of Object.values(imports)) {
      expect(url).toMatch(/^\.\/assets\/vellym-[\w-]+-[\w-]+\.js$/);
      expect(existsSync(path.join(clientRoot, url))).toBe(true);
    }
  });

  it("really exports the names plugins import", async () => {
    const imports = importsFromHtml();
    for (const [name, expected] of Object.entries(REQUIRED_EXPORTS)) {
      const target = imports[name];
      expect(target).toBeDefined();
      const module = await import(path.join(clientRoot, target!));
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

  it("points every bare specifier plugins may use at a hashed file", () => {
    const html = readFileSync(path.join(clientRoot, "index.html"), "utf8");
    const match = html.match(/<script type="importmap">(.*?)<\/script>/s);
    const imports = JSON.parse(match?.[1] ?? "{}").imports as Record<string, string>;
    expect(Object.keys(imports).sort()).toEqual([
      "@vellym/plugin-api",
      "@vellym/plugin-api/react",
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
      '{"imports":{"react":"./assets/vellym-react-abc123.js"}}',
      "</script>",
      '<script type="module" src="./assets/index-abc.js"></script>'
    ].join("");
    const rewritten = dynamicIndexHtml(Buffer.from(html, "utf8")).toString("utf8");
    expect(rewritten).toContain('"react":"/assets/vellym-react-abc123.js"');
    expect(rewritten).toContain('src="/assets/index-abc.js"');
    expect(rewritten).not.toContain('"./assets/vellym-');
  });
});
