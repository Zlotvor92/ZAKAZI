import { afterAll, describe, expect, it } from "vitest";
import { closePool, withRollback } from "./helpers";

afterAll(closePool);

describe("ograničenja koja su napravljena kao not valid", () => {
  it.each([
    "clients_phone_e164_format",
    "limit_exempt_phones_phone_e164_check",
    "push_subscriptions_endpoint_allowed",
  ])("%s je potvrđeno nad postojećim redovima", async (name) => {
    await withRollback(async (db) => {
      const result = await db.query<{ convalidated: boolean }>(
        "select convalidated from pg_constraint where conname = $1",
        [name],
      );

      expect(result.rows).toEqual([{ convalidated: true }]);
    });
  });
});
