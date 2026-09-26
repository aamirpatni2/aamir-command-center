import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The dev server proxies /api to the Fastify API so the session cookie stays same-origin.
// Only VITE_* variables reach the browser bundle; never put secrets in them.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.VITE_API_PROXY ?? "http://localhost:4000", changeOrigin: false } },
  },
  preview: { port: 5173, proxy: { "/api": { target: process.env.VITE_API_PROXY ?? "http://localhost:4000" } } },
});
