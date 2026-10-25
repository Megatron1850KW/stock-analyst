import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

/** Empaqueta las pruebas reales (tests/real) en .mjs sueltos para ejecutarlos con Node en el Mac. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    ssr: true,
    outDir: "dist-real",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      input: { "ai-real": "tests/real/ai-real.ts", "peers-real": "tests/real/peers-real.ts", "eu-probe": "tests/real/eu-probe.ts", "import-report": "tests/real/import-report.ts", "import-fund": "tests/real/import-fund.ts" },
      output: { entryFileNames: "[name].mjs", chunkFileNames: "[name].mjs" },
    },
  },
  ssr: { noExternal: true, target: "node" },
});
