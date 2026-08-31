import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const appNodeModules = path.resolve(appRoot, "node_modules");

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.resolve(appNodeModules, "react"),
      "react-dom": path.resolve(appNodeModules, "react-dom"),
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime"],
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
});
