import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { publicRouteMetadata } from "./src/lib/siteRoutes";

const demoRoot = fileURLToPath(new URL(".", import.meta.url));
const demoNodeModules = path.resolve(demoRoot, "node_modules");

/** Pages serves directories, without an SPA fallback. Ship an entry for each public route. */
function pagesEntrypoints(): Plugin {
  return {
    name: "markora-pages-entrypoints",
    async writeBundle(options, bundle) {
      const entry = bundle["index.html"];
      if (!options.dir || entry?.type !== "asset") throw new Error("Pages build has no HTML entry.");
      const outputDirectory = path.resolve(options.dir);
      await Promise.all(Object.keys(publicRouteMetadata).filter(route => route !== "/").map(async route => {
        const directory = path.join(outputDirectory, route.slice(1));
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "index.html"), entry.source);
      }));
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "pages" ? [pagesEntrypoints()] : [])],
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
}));
