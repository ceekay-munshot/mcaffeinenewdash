import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The clean dataset lives in /data/clean (outside /src). Alias it so the app can
// import it directly and Vite is allowed to read it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@data": fileURLToPath(new URL("./data", import.meta.url)),
    },
  },
  server: {
    fs: { allow: [".."] },
  },
});
