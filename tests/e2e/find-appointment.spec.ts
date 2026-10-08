import { expect, test } from "@playwright/test";
import pg from "pg";
import { sr } from "../../lib/i18n/sr";

const SLUG = "studio-milica";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function statusFor(e164: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ status: string }>(
      `select a.status from appointments a
         join clients c on c.id = a.client_id where c.phone_e164 = $1`,
      [e164],
    );
    return result.rows.map((row) => row.status);
  } finally {
    await client.end();
  }
}

test("„Pronađi svoj termin“ je vidljiv na početnoj strani salona i vodi do otkazivanja preko broja", async ({
  page,
}) => {
  const tail = String(Date.now()).slice(-7);
  const written = `064${tail}`;
  const e164 = `+38164${tail}`;

  await page.goto(`/${SLUG}`);
  await page.getByTestId("service-option").first().click();
  await page.getByTestId("day-option").nth(3).click();
  await page.getByTestId("slot-option").first().click();
  await page.getByLabel(sr.booking.nameLabel).fill("Ana Pronalazak");
  await page.getByLabel(sr.booking.phoneLabel).fill(written);
  await page.getByRole("button", { name: sr.booking.submit }).click();
  await expect(
    page.getByRole("heading", { name: sr.booking.confirmedTitle }),
  ).toBeVisible();

  await page.goto(`/${SLUG}`);

  // Vidljivo bez skrolovanja, a ne zakopano u podnožju iza cele forme.
  const entry = page.getByRole("link", { name: sr.booking.manageLink }).first();
  await expect(entry).toBeInViewport();
  await entry.click();

  await expect(page).toHaveURL(new RegExp(`/${SLUG}/otkazi$`));

  // Tuđ broj ne vidi ništa.
  await page.getByLabel(sr.booking.phoneLabel).fill("0653829471");
  await page.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(page.getByText(sr.cancel.empty)).toBeVisible();
  await expect(
    page.getByRole("button", { name: sr.cancel.cancelButton, exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: sr.cancel.changePhone }).click();
  await page.getByLabel(sr.booking.phoneLabel).fill(written);
  await page.getByRole("button", { name: sr.cancel.submit }).click();

  // Tek posle pronalaska termina stiže mogućnost otkazivanja, uz potvrdu.
  const cancel = page.getByRole("button", {
    name: sr.cancel.cancelButton,
    exact: true,
  });
  await cancel.click();
  await page.getByRole("button", { name: sr.cancel.cancelConfirm }).click();

  await expect(page.getByText(sr.cancel.cancelledTitle)).toBeVisible();
  expect(await statusFor(e164)).toEqual(["cancelled_by_client"]);
});
