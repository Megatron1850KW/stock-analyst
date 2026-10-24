import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

/** Empaqueta tests/real/ai-real.ts en un único .mjs para ejecutarlo con Node en el Mac. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    ssr: "tests/real/ai-real.ts",
    outDir: "dist-real",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: { output: { entryFileNames: "ai-real.mjs", inlineDynamicImports: true } },
  },
  ssr: { noExternal: true, target: "node" },
});
