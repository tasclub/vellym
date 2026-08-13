import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["packages/**/dist/**"],
    setupFiles: ["./tests/setup-i18n.ts"],
    coverage: {
      provider: "v8",
      // 計測対象は製品コードのみ。テスト用fixtureとビルド成果物は含めない。
      include: ["packages/*/src/**"],
      reporter: ["text", "html"]
    }
  }
});
