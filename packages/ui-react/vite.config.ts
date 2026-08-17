import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * プラグインと共有する固定名エントリ。
 *
 * **この4つだけファイル名を固定する。** 他の資産はハッシュ付きのままにする。
 * import mapはbare specifierをこの相対URLへ向けるため、名前が変わると
 * プラグインの読み込みが壊れる。Reactの実体はハッシュ付きの共有チャンクに
 * 入り、ここからre-exportするだけなので、キャッシュへの影響は4ファイルに
 * 限られる。
 */
const SHARED_ENTRIES = {
  "vellym-react": "src/shared-entries/vellym-react.ts",
  "vellym-react-dom": "src/shared-entries/vellym-react-dom.ts",
  "vellym-jsx-runtime": "src/shared-entries/vellym-jsx-runtime.ts",
  "vellym-ui": "src/shared-entries/vellym-ui.ts"
} as const;

/**
 * bare specifierから固定名ファイルへの対応。
 *
 * **specifierごとにファイルを分ける。** 1つへまとめると、import mapで
 * `react`と`react/jsx-runtime`を別々に指せない。
 */
const IMPORT_MAP: Record<string, string> = {
  react: "./assets/vellym-react.js",
  "react-dom": "./assets/vellym-react-dom.js",
  "react-dom/client": "./assets/vellym-react-dom.js",
  "react/jsx-runtime": "./assets/vellym-jsx-runtime.js",
  "react/jsx-dev-runtime": "./assets/vellym-jsx-runtime.js",
  "@vellym/ui": "./assets/vellym-ui.js"
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
      transformIndexHtml() {
        return [
          {
            tag: "script",
            attrs: { type: "importmap" },
            children: JSON.stringify({ imports: IMPORT_MAP }),
            injectTo: "head-prepend" as const
          }
        ];
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
        // 共有エントリだけ固定名。**他はハッシュ付きのまま。**
        entryFileNames: (chunk) =>
          chunk.name in SHARED_ENTRIES
            ? "assets/[name].js"
            : "assets/[name]-[hash].js"
      }
    }
  }
});
