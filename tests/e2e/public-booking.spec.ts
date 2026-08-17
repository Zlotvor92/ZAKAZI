import { expect, test } from "@playwright/test";
import pg from "pg";
import { sr } from "../../lib/i18n/sr";

/** Salon koji pravi `supabase/seed.sql`. */
const SLUG = "studio-milica";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Svaki prolaz koristi svoj broj, da limiti po broju ne obore drugi prolaz. */
function freshPhone(): string {
  const tail = String(Date.now()).slice(-7);
  return `064${tail}`;
}

function toE164(written: string): string {
  return `+381${written.slice(1)}`;
}

async function appointmentFor(phone: string) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{
      status: string;
      source: string;
      start_at: Date;
    }>(
      `select a.status, a.source, a.start_at
       from appointments a
       join clients c on c.id = a.client_id
       where c.phone_e164 = $1`,
      [toE164(phone)],
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

test("klijent zakaže sam, bez ijedne poruke", async ({ page }) => {
  const phone = freshPhone();

  await page.goto(`/${SLUG}`);

  await expect(
    page.getByRole("heading", { name: sr.booking.chooseService }),
  ).toBeVisible();

  await page.getByTestId("service-option").first().click();
  await page.getByTestId("day-option").first().click();

  const slot = page.getByTestId("slot-option").first();
  const chosenTime = (await slot.innerText()).trim();
  await slot.click();

  await page.getByLabel(sr.booking.nameLabel).fill("Jelena Petrović");
  await page.getByLabel(sr.booking.phoneLabel).fill(phone);
  await page.getByRole("button", { name: sr.booking.submit }).click();

  await expect(
    page.getByRole("heading", { name: sr.booking.confirmedTitle }),
  ).toBeVisible();

  // Potvrda na ekranu ne vredi ništa ako red nije u bazi.
  const rows = await appointmentFor(phone);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "confirmed", source: "public" });

  // I ono najvažnije: isti termin se više ne nudi sledećem klijentu.
  await page.goto(`/${SLUG}`);
  await page.getByTestId("service-option").first().click();
  await page.getByTestId("day-option").first().click();

  await expect(
    page.getByTestId("slot-option").filter({ hasText: chosenTime }),
  ).toHaveCount(0);
});

test("nepostojeći salon ne otkriva da ne postoji", async ({ page }) => {
  await page.goto("/nema-ovakvog-salona");

  await expect(page.getByText(sr.booking.closed)).toBeVisible();
});
