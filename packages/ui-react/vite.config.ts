import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // 相対base。ビルド成果物を任意サーバの任意サブパスへそのまま配置しても
  // アセットが解決できるようにする（静的配信の可搬性）。
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
