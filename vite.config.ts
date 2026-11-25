import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// MCP Apps views must be one self-contained HTML file.
export default defineConfig({
  root: "ui",
  plugins: [viteSingleFile()],
  build: { outDir: "../dist/ui", emptyOutDir: true, rollupOptions: { input: "ui/dashboard.html" } },
});
