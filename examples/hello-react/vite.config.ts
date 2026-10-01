import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Only the browser half is Vite's. The server in src/server runs Vite inside
// itself while developing, and serves what `vite build` writes to dist/.
export default defineConfig({
  plugins: [react()],
});
