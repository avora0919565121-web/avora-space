import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import pkg from "./package.json";

// AVORA-100 · G.1: a feedback note says which build it came from (`1.0.0+2026-10-11`).
const AVORA_VERSION = `${pkg.version}+${new Date().toISOString().slice(0, 10)}`;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  define: {
    __AVORA_VERSION__: JSON.stringify(AVORA_VERSION),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Expose both VITE_* (Vite default) and EXPO_PUBLIC_* (Rork's cross-platform
  // public-env convention, written by tools like getOrCreateAuthConfig).
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
}));
