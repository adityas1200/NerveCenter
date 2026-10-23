/// <reference types="vitest" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Production builds take VITE_* keys from the repo's tracked .env.defaults when nothing else
 * supplied them, the way zsnexos does. A pipeline that builds the image with no build args
 * (the dev one) then gets dev's values instead of the Dockerfile's sandbox defaults. A build
 * arg or real env var still wins; empty counts as unset, because an ARG nobody passed
 * reaches the build as "". Only production builds read it, so the dev server and tests are unchanged.
 */
function applyEnvDefaults(): void {
  const candidates = ["../.env.defaults", "./.env.defaults"].map((file) => fileURLToPath(new URL(file, import.meta.url)));
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(VITE_[A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!match) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

function productionBase(raw?: string): string {
  const base = (raw || "").trim() || "/";
  if (base === "/") return "/";
  const inner = base.replace(/^\/+|\/+$/g, "");
  return inner ? `/${inner}/` : "/";
}

export default defineConfig(({ mode }) => {
  if (mode === "production") applyEnvDefaults();
  return {
  plugins: [react()],
  base: mode === "production" ? productionBase(process.env.VITE_APP_BASE) : "/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5175,
    host: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || (mode === "e2e" ? "http://127.0.0.1:18787" : "http://127.0.0.1:8787"),
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          radix: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "@radix-ui/react-tooltip",
          ],
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: "jsdom",
    globals: true,
    testTimeout: 20_000,
    setupFiles: [fileURLToPath(new URL("./src/test/setup.ts", import.meta.url))],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}", "src/test/**", "src/main.tsx"],
    },
  },
};
});
