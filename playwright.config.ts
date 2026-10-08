import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

// WebKit ne prima `Secure` kolačiće preko običnog HTTP-a, pa iPhone prolaz ide
// kroz TLS proxy (`tests/e2e/tls-proxy.mjs`), kao produkcija.
const TLS_PORT = 3101;
const tlsBaseURL = `https://127.0.0.1:${TLS_PORT}`;
const webkit = Boolean(process.env["E2E_WEBKIT"]);

/**
 * U CI-ju se testira ono što se stvarno objavljuje: `next build` pa
 * `next start`. Razvojni server ume da sakrije greške koje produkcija ima
 * (drugačiji keš, bez HMR-a, minifikovan kod, produkciona zaglavlja), a
 * lokalno je brži i zato ostaje podrazumevan.
 */
const production = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Testovi dele jedan salon iz seed-a, pa ne smeju paralelno da ga gaze.
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      // Devedeset posto korisnika je na telefonu; testira se to, ne desktop.
      name: "android",
      use: { ...devices["Pixel 7"] },
    },
    // iPhone koristi WebKit, a on ume da se ponaša drugačije od Chrome-a
    // (tastatura, `100dvh`, kolačići). Uključuje se samo uz `E2E_WEBKIT=1`,
    // jer traži sistemske biblioteke koje obični posao ne instalira.
    ...(webkit
      ? [
          {
            name: "iphone",
            use: {
              ...devices["iPhone 14"],
              baseURL: tlsBaseURL,
              ignoreHTTPSErrors: true,
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: production
        ? `npm run build && npm run start -- --port ${PORT}`
        : `npm run dev -- --port ${PORT}`,
      url: baseURL,
      reuseExistingServer: !process.env["CI"],
      timeout: production ? 300_000 : 180_000,
    },
    ...(webkit
      ? [
          {
            command: "node tests/e2e/tls-proxy.mjs",
            url: tlsBaseURL,
            ignoreHTTPSErrors: true,
            reuseExistingServer: !process.env["CI"],
            timeout: 30_000,
          },
        ]
      : []),
  ],
});
