import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * プラグインと共有するハッシュ付きエントリ。
 * import mapは毎回生成されキャッシュされないindex.htmlにあるため名前は変わってよい。
 */
const SHARED_ENTRIES = {
  "vellym-react": "src/shared-entries/vellym-react.ts",
  "vellym-react-dom": "src/shared-entries/vellym-react-dom.ts",
  "vellym-jsx-runtime": "src/shared-entries/vellym-jsx-runtime.ts",
  "vellym-ui": "src/shared-entries/vellym-ui.ts",
  "vellym-plugin-api": "src/shared-entries/vellym-plugin-api.ts",
  "vellym-plugin-api-react": "src/shared-entries/vellym-plugin-api-react.ts"
} as const;

/**
 * bare specifierから共有エントリ名への対応。URLはビルド時に生成する。
 *
 * **specifierごとにファイルを分ける。** 1つへまとめると、import mapで
 * `react`と`react/jsx-runtime`を別々に指せない。
 */
const IMPORT_MAP: Record<string, string> = {
  react: "vellym-react",
  "react-dom": "vellym-react-dom",
  "react-dom/client": "vellym-react-dom",
  "react/jsx-runtime": "vellym-jsx-runtime",
  "react/jsx-dev-runtime": "vellym-jsx-runtime",
  "@vellym/plugin-api/ui": "vellym-ui",
  "@vellym/plugin-api": "vellym-plugin-api",
  "@vellym/plugin-api/react": "vellym-plugin-api-react"
};

export default defineConfig({
  // 相対base。ビルド成果物を任意サーバの任意サブパスへそのまま配置しても
  // アセットが解決できるようにする（静的配信の可搬性）。
  base: "./",
  // @vellym/plugin-api の公開exportsはdistを指す。ワークスペースではsrcを見る。
  // 既定条件を置き換える指定なので、Viteの既定分も併記する。
  resolve: {
    conditions: ["vellym-source", "module", "browser", "development|production"]
  },
  plugins: [
    react(),
    {
      name: "vellym-import-map",
      /**
       * import mapを`<head>`の先頭へ入れる。
       *
       * **documentに1つだけ、かつ最初のmodule読み込みより前**でなければ
       * 効かない。Viteが挿入する`<script type="module">`は`head`の後方か
       * `body`に来るため、先頭へ置けば順序を満たす。
       *
       * 相対値はdocument baseを起点に解決されるので、静的版を任意の
       * サブパスへ置いても壊れない。
       */
      transformIndexHtml: {
        order: "post",
        handler(_html, ctx) {
          if (!ctx.bundle) return;
          const entries = new Map(Object.values(ctx.bundle)
            .filter((chunk) => chunk.type === "chunk" && chunk.isEntry && chunk.name in SHARED_ENTRIES)
            .map((chunk) => [chunk.name, `./${chunk.fileName}`]));
          const imports = Object.fromEntries(Object.entries(IMPORT_MAP).map(([specifier, name]) => {
            const url = entries.get(name);
            if (!url) throw new Error(`Missing shared entry: ${name}`);
            return [specifier, url];
          }));
          return [
            {
              tag: "script",
              attrs: { type: "importmap" },
              children: JSON.stringify({ imports }),
              injectTo: "head-prepend" as const
            }
          ];
        }
      }
    }
  ],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      /**
       * **共有エントリのexport名を保つ。**
       *
       * Viteのアプリ向け既定は`false`で、Rollupがentryのexportを削除・改名
       * してよいことになっている。共有エントリはプラグインから名前で読まれる
       * ため、それでは`useState`が`a`になって消える。実測でそうなった。
       */
      preserveEntrySignatures: "strict",
      input: {
        index: fileURLToPath(new URL("index.html", import.meta.url)),
        ...Object.fromEntries(
          Object.entries(SHARED_ENTRIES).map(([name, file]) => [
            name,
            fileURLToPath(new URL(file, import.meta.url))
          ])
        )
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js"
      }
    }
  }
});
