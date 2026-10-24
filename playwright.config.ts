import { defineConfig } from "@playwright/test";

// Tests de UI sobre la vista previa en navegador (sin Tauri).
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:1420", viewport: { width: 1280, height: 820 } },
  webServer: { command: "npm run dev", url: "http://localhost:1420", reuseExistingServer: true },
});
