// Privremeno: lokalni Chromium je stariji build nego što ga ova verzija
// Playwright-a traži, pa se putanja zadaje ručno. U CI-ju ovo ne treba.
import base from "../playwright.config";
import path from "node:path";

export default {
  ...base,
  testDir: path.join(import.meta.dirname, "..", "tests", "e2e"),
  use: {
    ...base.use,
    launchOptions: {
      executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    },
  },
};
