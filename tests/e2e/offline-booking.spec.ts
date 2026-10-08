import { expect, test } from "@playwright/test";
import pg from "pg";
import { sr } from "../../lib/i18n/sr";

const SLUG = "studio-milica";
const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function countFor(e164: string): Promise<number> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `select count(*)::int as n from appointments a
         join clients c on c.id = a.client_id where c.phone_e164 = $1`,
      [e164],
    );
    return result.rows[0].n;
  } finally {
    await client.end();
  }
}

test("bez veze zakazivanje se ne šalje i ne obećava termin", async ({
  page,
  context,
}) => {
  const tail = String(Date.now()).slice(-7);

  await page.goto(`/${SLUG}`);
  await page.getByTestId("service-option").first().click();
  await page.getByTestId("day-option").nth(4).click();
  await page.getByTestId("slot-option").first().click();
  await page.getByLabel(sr.booking.nameLabel).fill("Offline Test");
  await page.getByLabel(sr.booking.phoneLabel).fill(`064${tail}`);

  const submit = page.getByRole("button", { name: sr.booking.submit });
  await expect(submit).toBeEnabled();

  await context.setOffline(true);

  await expect(page.getByText(sr.offline.booking)).toBeVisible();
  await expect(submit).toBeDisabled();

  await context.setOffline(false);

  await expect(page.getByText(sr.offline.booking)).toHaveCount(0);
  await expect(submit).toBeEnabled();

  // Ništa nije poslato dok je veze nema.
  expect(await countFor(`+38164${tail}`)).toBe(0);
});
