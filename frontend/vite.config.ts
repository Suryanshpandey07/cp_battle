import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shared = fileURLToPath(new URL("../shared", import.meta.url));
// scripts/dev.sh passes the port it picked for the API (8000 unless that was taken).
const apiPort = process.env.ALGOARENA_API_PORT ?? "8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@shared": shared } },
  server: {
    port: 5173,
    fs: { allow: [".", shared] },
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      "/ws": { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { manualChunks: { react: ["react", "react-dom"] } } },
  },
  test: { environment: "jsdom", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },
});
