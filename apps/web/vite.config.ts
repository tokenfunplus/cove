import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  build: {
    emptyOutDir: true,
    outDir: path.resolve(import.meta.dirname, "../../services/local-service/internal/webassets/content/dist"),
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "assets/chunk-[name].js",
        entryFileNames: "assets/app.js"
      }
    }
  }
});
