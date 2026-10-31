import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

const APP_VERSION: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// Dev server proxies /api/* to the Node sidecar so dev mimics prod exactly.
// In production, `node server/index.mjs` serves dist/ and handles /api/*
// itself. See docs/ADR-001-stack.md.

const SERVER_URL = process.env.CHRONICLER_SERVER_URL ?? "http://localhost:3001";

export default defineConfig({
  // The page knows which version it is, so it can notice the server has been updated underneath it.
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: false,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: SERVER_URL,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: SERVER_URL,
        changeOrigin: true,
      },
    },
  },
});
