# Poznate ranjivosti u zavisnostima

Stanje posle podizanja na `next@15.5.27` (8. oktobar 2026). CI blokira `high` i
`critical` u produkcionim zavisnostima (`npm audit --omit=dev --audit-level=high`);
ovo je spisak onoga što `npm audit` prijavljuje i zašto.

**Produkcija: `npm audit --omit=dev` → 0 ranjivosti.**

## Zatvoreno

| Paket | Bilo | Sada | Kako |
|---|---|---|---|
| `next` | 15.5.26 | 15.5.27 | Podignut zajedno sa `eslint-config-next`. |
| `postcss` ugnežđen u `next` (`<=8.5.22`: `</style>` XSS, čitanje `.map` fajlova) | 8.4.31 | 8.5.29 | `overrides.next.postcss`: Next sada koristi isti `postcss` kao ostatak projekta. Build (Turbopack) i svi testovi prolaze. |
| `sharp` (libvips/libheif CVE) | 0.34.5 | 0.35.5 | `overrides.sharp`. Next dozvoljava `^0.34.3 \|\| ^0.35.4`. Koristi je samo `next/image`, koji aplikacija ne koristi. |
| `source-map-js` (DoS preko indeksiranih source mapa) | 1.2.1 | 1.2.2 | `overrides.source-map-js`. |
| `js-yaml` (`<4.3.2`) | 4.3.1 | 4.3.2 | `overrides.js-yaml`. |
| `vitest` / `@vitest/mocker` (`<4.1.11`) | 4.1.10 | 4.1.11 | Podignut direktno. |

`npm audit fix` i `npm install` sa `overrides` puknu sa `Cannot read properties of null
(reading 'edgesOut')` u npm 10.9 (greška samog npm-a u ovom stablu). Podizanje je rađeno
sa `npx npm@12 install`; običan `npm ci` sa dobijenim `package-lock.json` radi i na npm 10.

`overrides` treba povremeno proveriti: kad Next sam podigne `postcss` i `sharp`, red u
`package.json` postaje suvišan i skida se.

## Preostalo (samo razvoj, ne ide u produkciju)

| Paket | Stepen | Zašto ostaje |
|---|---|---|
| `braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next` → `eslint-config-next` | high | Lanac je samo u ESLint-u. `braces` čita obrasce iz našeg `eslint.config.mjs`, nikad korisnički ulaz. Ispravka traži `eslint-config-next@14` (nazad, razbija konfiguraciju). Vratiti se kad Next objavi `eslint-config-next` sa novijim `fast-glob`. |
| `brace-expansion` (`<=1.1.20`, `4.0.0 - 5.0.11`) | high | Samo razvoj (`minimatch` unutar ESLint-a i `typescript-estree`). Za granu 1.x nema ispravljene verzije, a prisiljavanje 5.x na paket koji traži `^1.1.7` bi ga slomilo. |

Rok za ponovnu proveru: sledeće podizanje Next-a ili 1. decembar 2026, šta bude prvo.
