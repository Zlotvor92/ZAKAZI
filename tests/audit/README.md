# Otvoreni nalazi iz revizije

Ono što je popravljeno prešlo je u glavne testove (`tests/db`, `tests/e2e`,
`tests/actions`). Ovde su ostali samo nalazi koji još NISU popravljeni i njihovi
dokazi, koji trenutno PADAJU:

- `db/misc.repro.ts`
  - F-13: `create_appointment` baca `check_violation` za strani broj umesto
    `invalid_phone` (UI ne može da ga izazove).
  - F-11: `push_subscriptions.endpoint` prima proizvoljan https host.

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres \
  npx vitest run --config tests/audit/vitest.config.ts
```
