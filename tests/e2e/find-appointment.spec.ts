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

test("find and cancel from another browser with only the phone", async ({ page, browser }) => {
  const tail = String(Date.now()).slice(-7);
  const written = `064${tail}`;
  const e164 = `+38164${tail}`;
  await page.goto(`/${SLUG}`);
  await page.getByTestId("service-option").first().click();
  await page.getByTestId("day-option").nth(3).click();
  await page.getByTestId("slot-option").first().click();
  await page.getByLabel(sr.booking.nameLabel).fill("Test klijentkinja");
  await page.getByLabel(sr.booking.phoneLabel).fill(written);
  await page.getByRole("button", { name: sr.booking.submit }).click();
  await expect(page.getByRole("heading", { name: sr.booking.confirmedTitle })).toBeVisible();

  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto(`/${SLUG}/otkazi`);
  await other.getByLabel(sr.booking.phoneLabel).fill("0653829471");
  await other.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(other.getByText(sr.cancel.empty)).toBeVisible();
  await expect(other.getByRole("button", { name: sr.cancel.cancelButton, exact: true })).toHaveCount(0);
  expect(await statusFor(e164)).toEqual(["confirmed"]);

  await other.getByRole("button", { name: sr.cancel.changePhone }).click();
  await other.getByLabel(sr.booking.phoneLabel).fill(written);
  await other.getByRole("button", { name: sr.cancel.submit }).click();
  await other.getByRole("button", { name: sr.cancel.cancelButton, exact: true }).click();
  await other.getByRole("button", { name: sr.cancel.cancelConfirm }).click();
  await expect(other.getByText(sr.cancel.cancelledTitle)).toBeVisible();
  expect(await statusFor(e164)).toEqual(["cancelled_by_client"]);
  await second.close();
});
