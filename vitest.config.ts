import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `tsconfig.json` ima `jsx: preserve` jer Next sam transformiše JSX; testovi
  // koji crtaju komponente traže da to uradi Vite.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/domain/**/*.test.ts",
      "tests/pwa/**/*.test.ts",
      "tests/supabase/**/*.test.ts",
      "tests/actions/**/*.test.ts",
    ],
    passWithNoTests: true,
  },
});
