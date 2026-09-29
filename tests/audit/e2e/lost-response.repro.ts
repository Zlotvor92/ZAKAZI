import { expect, test } from "@playwright/test";
import pg from "pg";
import { sr } from "../../../lib/i18n/sr";

/**
 * AUDIT — [REPRO] odgovor na zakazivanje se izgubi, a termin je u bazi.
 * Ispravno ponašanje: klijentkinja ne dobija poruku "ništa nije sačuvano" i
 * ponovni pritisak ne završava greškom. Test trenutno PADA.
 */
const SLUG = process.env["AUDIT_SLUG"] ?? "studio-milica";
const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function countAppointments(e164: string): Promise<number> {
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

test("[REPRO] izgubljen odgovor: termin postoji, a ekran kaže da ništa nije sačuvano", async ({
  page,
}) => {
  const tail = String(Date.now()).slice(-7);
  const written = `064${tail}`;
  const e164 = `+38164${tail}`;

  await page.goto(`/${SLUG}`);
  await page.getByTestId("service-option").first().click();
  await page.getByTestId("day-option").nth(2).click();
  await page.getByTestId("slot-option").first().click();
  await page.getByLabel(sr.booking.nameLabel).fill("Marija Test");
  await page.getByLabel(sr.booking.phoneLabel).fill(written);

  let dropped = false;
  await page.route(`**/${SLUG}`, async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch(); // server izvrši akciju
      await route.abort("failed"); // odgovor se gubi
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: sr.booking.submit }).click();
  await expect.poll(() => countAppointments(e164)).toBe(1);

  // Očekivano: ekran ne tvrdi da ništa nije sačuvano (ili pokaže potvrdu).
  await expect(page.getByText(sr.error.unreachable)).toHaveCount(0);
});
