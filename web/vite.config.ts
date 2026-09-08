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
    emptyOutDir: true,
    // Split the heavyweight vendors into their own chunks so route-level
    // lazy loading (App.tsx) actually keeps them off the first paint.  The
    // single default bundle previously measured 3.1MB and stalled cold loads.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|react-is)[\\/]/.test(id)) {
            return "react-vendor";
          }
          if (/[\\/]node_modules[\\/](echarts|zrender)[\\/]/.test(id)) return "echarts";
          if (/[\\/]node_modules[\\/](@codemirror|@lezer|@uiw|crelt)[\\/]/.test(id)) return "editor";
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return "three";
          if (/[\\/]node_modules[\\/]ogl[\\/]/.test(id)) return "ogl";
          if (/[\\/]node_modules[\\/](react-markdown|remark-gfm|remark-|rehype-|micromark|mdast-|hast-|unist-|vfile|unified|devlop|html-url-attributes|github-slugger)[^\\/]*[\\/]/.test(id)) {
            return "markdown";
          }
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 1024
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
    include: ["src/features/**/*.test.ts", "src/components/dashboard/**/*.test.ts", "src/lib/**/*.test.ts", "src/app/settings/**/*.test.tsx", "src/pages/**/*.test.tsx"],
    globals: false,
    passWithNoTests: true
  }
});
