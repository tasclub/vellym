import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["packages/**/dist/**"],
    setupFiles: ["./tests/setup-i18n.ts"]
  }
});
