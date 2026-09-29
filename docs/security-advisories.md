# Poznate ranjivosti u zavisnostima

Stanje posle prelaska na `next@15.5.26`. CI blokira samo `critical` u produkcionim
zavisnostima (`npm audit --omit=dev --audit-level=critical`); ovo je spisak onoga što
`npm audit` i dalje prijavljuje i zašto to za sada ostaje.

| Paket | Stepen | Tip | Zašto ostaje |
|---|---|---|---|
| `next` (2 advisory-ja: RCE u Image Optimization API-ju sa AVIF, RCE na Windows serverima) | critical | produkcija | **Zatvoreno.** Ispravljeno u 15.5.24; instalirano 15.5.26. |
| `postcss` ugnežđen u `next` (`<=8.5.22`: `</style>` XSS, čitanje `.map` fajlova preko `sourceMappingURL`) | high | produkcija (build) | Ispravka traži `next@16` (major), što je van ovog zadatka. Ranjivost se aktivira kad postcss obrađuje CSS koji piše napadač; ovde postcss obrađuje samo sopstveni CSS pri build-u, nikad ulaz korisnika. Vratiti se kad se pređe na Next 16. |
| `sharp` (`<=0.35.4`, libvips/libheif CVE) | high | opciona zavisnost Next-a | Koristi je samo `next/image` optimizator; aplikacija ne koristi `next/image` (logo je običan `<img>`, bez `images.remotePatterns`). `npm audit fix` puca u ovom stablu (`Cannot read properties of null (reading 'edgesOut')`, greška samog npm-a), pa ručno podizanje nije rađeno. Proveriti ponovo posle sledećeg podizanja Next-a. |
| `vitest` / `@vitest/mocker` (`<4.1.11`) | moderate | samo razvoj | Ne ide u produkciju. Podizanje na `4.1.11` puca istom npm greškom kao gore. |
| `js-yaml` (`<4.3.2`, preko `@eslint/eslintrc`) | high | samo razvoj | Ne ide u produkciju; parsira samo naše konfiguracione fajlove. |

Poslednja provera: `npm audit --omit=dev --audit-level=critical` → izlaz 0.
