import { expect, test } from "@playwright/test";
import pg from "pg";
import { sr } from "../../lib/i18n/sr";

/**
 * Odgovor na zakazivanje se izgubi a termin je već u bazi (mobilna mreža).
 * Ekran ne sme da tvrdi da ništa nije sačuvano, a ponovni pritisak mora da vrati
 * isti termin, ne drugi ni grešku.
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

test("izgubljen odgovor: poruka ne laže, a ponovni pritisak vraća isti termin", async ({
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
      await route.fetch(); // server izvrši akciju, termin nastaje
      await route.abort("failed"); // odgovor se gubi
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: sr.booking.submit }).click();

  await expect(page.getByText(sr.booking.connectionLost)).toBeVisible();
  await expect(page.getByText(sr.error.unreachable)).toHaveCount(0);
  expect(await countAppointments(e164)).toBe(1);

  // Isti pritisak ponovo, bez čekanja od 30 s.
  await page.getByRole("button", { name: sr.booking.submit }).click();

  await expect(
    page.getByRole("heading", { name: sr.booking.confirmedTitle }),
  ).toBeVisible();
  expect(await countAppointments(e164)).toBe(1);

  // Kolačić sa tajnom je izgubljen sa prvim odgovorom; ponovljen zahtev ga
  // postavlja, pa otkazivanje radi na ovom telefonu.
  //
  // Posle potvrde stranica još osvežava podatke (`router.refresh`); u WebKit-u
  // taj zahtev ume da prekine navigaciju koja krene tokom njega.
  await page.waitForLoadState("networkidle");
  await page.goto(`/${SLUG}/otkazi`);
  await page.getByLabel(sr.booking.phoneLabel).fill(written);
  await page.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(
    page.getByRole("button", { name: sr.cancel.cancelButton, exact: true }),
  ).toBeVisible();
});
