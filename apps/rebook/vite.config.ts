import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Only the browser half is Vite's. The server in src/server runs Vite inside
// itself while developing, and serves what `vite build` writes to dist/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/` is src/client, where shadcn's components.json puts them
  resolve: { alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) } },
});
