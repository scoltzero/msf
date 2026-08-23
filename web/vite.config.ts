import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const src = path.resolve(__dirname, "src");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": src,
      "next/link": path.resolve(src, "compat/next-link.tsx"),
      "next/image": path.resolve(src, "compat/next-image.tsx"),
      "next/navigation": path.resolve(src, "compat/next-navigation.ts")
    }
  },
  build: {
    outDir: path.resolve(__dirname, "../internal/server/web/dist"),
    emptyOutDir: true
  },
  worker: {
    format: "es"
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:7777"
    }
  },
  preview: {
    host: "0.0.0.0"
  },
  test: {
    environment: "node",
    include: ["src/features/**/*.test.ts", "src/components/dashboard/**/*.test.ts", "src/lib/**/*.test.ts"],
    globals: false,
    passWithNoTests: true
  }
});
