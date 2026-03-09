import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const demoRoot = fileURLToPath(new URL(".", import.meta.url));
const demoNodeModules = path.resolve(demoRoot, "node_modules");

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.resolve(demoNodeModules, "react"),
      "react-dom": path.resolve(demoNodeModules, "react-dom"),
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react-router-dom"],
  },
  server: {
    port: 5173,
    open: true,
    strictPort: false,
  },
});
