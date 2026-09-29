import { defineConfig, devices } from "@playwright/test";

/**
 * E2E dokazi iz revizije. Isto kao glavna konfiguracija, samo što traži
 * `*.repro.ts` u ovom folderu i ne diže sam server: očekuje aplikaciju na
 * AUDIT_BASE_URL (podrazumevano http://127.0.0.1:3100).
 *
 *   AUDIT_SLUG=studio-milica npx playwright test -c tests/audit/playwright.config.ts
 */
export default defineConfig({
  testDir: ".",
  testMatch: "e2e/**/*.repro.ts",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env["AUDIT_BASE_URL"] ?? "http://127.0.0.1:3100",
    ...devices["Pixel 7"],
    launchOptions: process.env["AUDIT_CHROMIUM"]
      ? { executablePath: process.env["AUDIT_CHROMIUM"] }
      : {},
  },
});
