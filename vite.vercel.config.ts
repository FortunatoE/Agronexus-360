import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Vercel serves a browser-only build. The Cloudflare/Vinext configuration used
// by the Sites host remains in vite.config.ts and is not changed by this file.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  build: {
    outDir: "dist-vercel",
    emptyOutDir: true,
  },
});
