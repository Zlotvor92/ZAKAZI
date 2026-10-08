import { expect, test, type Page } from "@playwright/test";
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

/** Zakazuje kao klijentkinja i vraća tajnu termina koju je stranica smislila. */
async function bookAs(
  page: Page,
  written: string,
  name: string,
): Promise<string> {
  await page.goto(`/${SLUG}`);
  await page.getByTestId("service-option").first().click();
  await page.getByTestId("day-option").nth(3).click();
  await page.getByTestId("slot-option").first().click();
  await page.getByLabel(sr.booking.nameLabel).fill(name);
  await page.getByLabel(sr.booking.phoneLabel).fill(written);

  const secret = await page.locator('input[name="manageProof"]').inputValue();
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

  await page.getByRole("button", { name: sr.booking.submit }).click();
  await expect(
    page.getByRole("heading", { name: sr.booking.confirmedTitle }),
  ).toBeVisible();

  return secret;
}

function freshPhone() {
  const tail = String(Date.now()).slice(-7);
  return { written: `064${tail}`, e164: `+38164${tail}` };
}

test("„Pronađi svoj termin“: vidljiv, traži broj i dokaz, a sačuvan link otvara termin na drugom pregledaču", async ({
  browser,
  browserName,
  context,
  page,
}) => {
  // Jedno zakazivanje za ceo tok: lokalni i CI stek puštaju najviše osam
  // zakazivanja na sat sa iste mreže, a ovaj fajl deli to ograničenje sa
  // ostalima.
  const { written, e164 } = freshPhone();
  const secret = await bookAs(page, written, "Jelena Zaštićena");
  const origin = new URL(page.url()).origin;

  // Bez kolačića sa tajnom ništa dalje ne može da radi; ovde se vidi zašto.
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "zakazi_termini"),
  ).toBe(true);
  let link = `${origin}/${SLUG}/otkazi#k=${secret}`;

  // Potvrda ne sme da širi stranicu preko ivice telefona: mobilni pregledač
  // tada proširi prozor i stranica se ne skroluje do kraja. Puls oko dugmeta
  // „Dodaj u kalendar" menja `scrollWidth` i kad ne dotakne `innerWidth`.
  expect(
    await page.evaluate(
      () =>
        innerWidth === visualViewport?.width &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  // Link koji potvrda nudi nosi tajnu termina. Dozvola za međuspremnik postoji
  // samo u Chromium-u; drugde se link sastavlja iz iste tajne.
  await expect(page.getByText(sr.booking.saveLink.title)).toBeVisible();
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .getByRole("button", { name: sr.booking.saveLink.button })
      .click();
    await expect(page.getByText(sr.booking.saveLink.copied)).toBeVisible();
    link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(`${origin}/${SLUG}/otkazi#k=${secret}`);
  }

  // Isti pregledač: ulaz je vidljiv bez skrolovanja, tuđ broj ne vidi ništa,
  // pravi broj vidi termin.
  await page.goto(`/${SLUG}`);
  const entry = page.getByRole("link", { name: sr.booking.manageLink }).first();
  await expect(entry).toBeInViewport();
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`/${SLUG}/otkazi$`));

  await page.getByLabel(sr.booking.phoneLabel).fill("0653829471");
  await page.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(page.getByText(sr.cancel.empty)).toBeVisible();
  await expect(
    page.getByRole("button", { name: sr.cancel.cancelButton, exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: sr.cancel.changePhone }).click();
  await page.getByLabel(sr.booking.phoneLabel).fill(written);
  await page.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(
    page.getByRole("button", { name: sr.cancel.cancelButton, exact: true }),
  ).toBeVisible();

  // Drugi pregledač, isti broj: bez linka ne vidi ništa.
  const stranger = await browser.newContext();
  const guest = await stranger.newPage();
  await guest.goto(`/${SLUG}/otkazi`);
  await guest.getByLabel(sr.booking.phoneLabel).fill(written);
  await guest.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(guest.getByText(sr.cancel.empty)).toBeVisible();
  await expect(guest.getByText(sr.cancel.emptyHelp)).toBeVisible();
  await expect(
    guest.getByRole("button", { name: sr.cancel.cancelButton, exact: true }),
  ).toHaveCount(0);
  expect(await statusFor(e164)).toEqual(["confirmed"]);
  await stranger.close();

  // Izmišljen link ne otvara ništa, ni uz pravi broj.
  const forger = await browser.newContext();
  const fake = await forger.newPage();
  await fake.goto(`/${SLUG}/otkazi#k=${"x".repeat(43)}`);
  await fake.getByLabel(sr.booking.phoneLabel).fill(written);
  await fake.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(fake.getByText(sr.cancel.empty)).toBeVisible();
  expect(await statusFor(e164)).toEqual(["confirmed"]);
  await forger.close();

  // Pravi link otvara termin tek uz pravi broj.
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto(link);
  await expect(other.getByText(sr.cancel.introLink)).toBeVisible();
  await other.getByLabel(sr.booking.phoneLabel).fill("0653829471");
  await other.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(other.getByText(sr.cancel.empty)).toBeVisible();
  expect(await statusFor(e164)).toEqual(["confirmed"]);

  await other.getByRole("button", { name: sr.cancel.changePhone }).click();
  await other.getByLabel(sr.booking.phoneLabel).fill(written);
  await other.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(
    other.getByRole("button", { name: sr.cancel.cancelButton, exact: true }),
  ).toBeVisible();
  // Tajna je sada u kolačiću tog pregledača, pa link nestaje iz adrese.
  await expect(other).toHaveURL(new RegExp(`/${SLUG}/otkazi$`));

  // I bez linka sada radi na tom pregledaču.
  await other.goto(`/${SLUG}/otkazi`);
  await other.getByLabel(sr.booking.phoneLabel).fill(written);
  await other.getByRole("button", { name: sr.cancel.submit }).click();
  await expect(
    other.getByRole("button", { name: sr.cancel.cancelButton, exact: true }),
  ).toBeVisible();
  await second.close();

  // Otkazivanje na pregledaču sa kog je zakazano: dva dodira, drugi je potvrda.
  await page
    .getByRole("button", { name: sr.cancel.cancelButton, exact: true })
    .click();
  await page.getByRole("button", { name: sr.cancel.cancelConfirm }).click();

  await expect(page.getByText(sr.cancel.cancelledTitle)).toBeVisible();
  expect(await statusFor(e164)).toEqual(["cancelled_by_client"]);
});
