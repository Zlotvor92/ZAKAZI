import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Testovi iz revizije. `*.repro.ts` opisuju ISPRAVNO ponašanje i trenutno
 * PADAJU (svaki je dokaz jednog nalaza); `*.verified.ts` prolaze i potvrđuju
 * da nešto radi kako treba. Ne pokreću se uz `npm run test:db`.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres \
 *     npx vitest run --config tests/audit/vitest.config.ts
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../..", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/audit/db/**/*.{repro,verified}.ts"],
    globalSetup: ["tests/db/globalSetup.ts"],
    fileParallelism: false,
  },
});
