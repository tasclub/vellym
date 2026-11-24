import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // @vellym/plugin-api は公開パッケージであり、exportsはdistを指す。
      // テストはワークスペースのsrcを見る。conditionsではなくaliasにするのは、
      // Viteのclient／ssrで条件解決の既定が異なり、他の依存の解決まで
      // 巻き込むためである。
      // subpathの方を先に置く。aliasは前方一致なので、順番が逆だと
      // `@vellym/plugin-api/react` が index.ts の下へ潜ってしまう。
      "@vellym/plugin-api/react": fileURLToPath(
        new URL("./packages/plugin-api/src/react.ts", import.meta.url)
      ),
      "@vellym/plugin-api/ui": fileURLToPath(
        new URL("./packages/plugin-api/src/ui/runtime.ts", import.meta.url)
      ),
      "@vellym/plugin-api": fileURLToPath(
        new URL("./packages/plugin-api/src/index.ts", import.meta.url)
      ),
      "@vellym/tickets": fileURLToPath(
        new URL("./packages/plugin-tickets/src/node.ts", import.meta.url)
      )
    }
  },
  test: {
    setupFiles: ["./tests/setup-i18n.ts"],
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/**/*.test.ts"], exclude: ["tests/**/*.integration.test.ts"] } },
      { extends: true, test: { name: "integration", include: ["tests/**/*.integration.test.ts"] } }
    ],
    coverage: {
      provider: "v8",
      // 計測対象は製品コードのみ。テスト用fixtureとビルド成果物は含めない。
      include: ["packages/*/src/**"],
      reporter: ["text", "html"]
    }
  }
});
