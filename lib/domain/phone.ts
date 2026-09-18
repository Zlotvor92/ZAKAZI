const SERBIA_COUNTRY_CODE = "381";

/**
 * Nacionalni broj u Srbiji je 8 ili 9 cifara pošto se odbaci nula ispred:
 * 064 123 456 i 064 123 4567 su oba u upotrebi, kao i 011 234 5678.
 */
const SERBIA_NATIONAL_MIN = 8;
const SERBIA_NATIONAL_MAX = 9;

/** Mobilni broj je `06x`, pa nacionalni oblik počinje šesticom. */
const SERBIA_MOBILE_PREFIX = "6";

/** Ista provera koju radi ograničenje `clients_phone_e164_format` u bazi. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Razmak, crta, kosa crta, tačka i zagrada su način na koji ljudi pišu broj. */
const WRITTEN_PHONE = /^\+?[0-9\s()./-]+$/;

export type PhoneProblem =
  | "empty"
  | "not_a_number"
  | "too_short"
  | "too_long"
  | "looks_fake"
  | "foreign";

/**
 * Broj koji je neko izmislio dok je kucao.
 *
 * Gleda se pretplatnički deo, bez mrežnog prefiksa: u `641234567` to je
 * `1234567`. Stvaran broj takav praktično ne postoji, a upravo tako izgleda
 * ono što se otkuca kad se ne planira doći.
 *
 * Niz cifara je signal samo na mobilnom broju. Na fiksnom je pretplatnički
 * deo kraći i pravilniji, pa bi `011 234 5678` — običan beogradski broj —
 * ispao lažan. Sve iste cifre ostaje signal na svakoj mreži.
 *
 * Isto pravilo stoji i u `phone_looks_fake` u bazi; test
 * `tests/db/fake-number.test.ts` pukne ako se raziđu.
 */
function looksFake(national: string): boolean {
  // Prve dve cifre su mreža (`64`, `11`), ostalo je pretplatnik.
  const subscriber = national.slice(2);

  if (subscriber.length >= 6 && /^(\d)\1+$/.test(subscriber)) {
    return true;
  }

  // Sedam, ne šest: u kraćem obliku broja (`064 123 456`) pretplatnički deo
  // ima tačno šest cifara, pa bi niz od šest odbio i stvaran broj.
  if (subscriber.length < 7) {
    return false;
  }

  if (!national.startsWith(SERBIA_MOBILE_PREFIX)) {
    return false;
  }

  let ascending = true;
  let descending = true;
  for (let i = 1; i < subscriber.length; i += 1) {
    const step = Number(subscriber[i]) - Number(subscriber[i - 1]);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }

  return ascending || descending;
}

export type PhoneNormalization =
  | { ok: true; e164: string }
  | { ok: false; reason: PhoneProblem };

/**
 * Broj kako ga je neko otkucao pretvara u E.164. Podrazumevana zemlja je
 * Srbija, pa `0641234567` i `641234567` daju isto što i `+381641234567`.
 * Strani brojevi se odbijaju: salon zove nazad sa srpske mreže, pa broj koji
 * niko ne može da pozove nije zakazivanje, samo zauzet termin.
 */
export function normalizePhone(input: string): PhoneNormalization {
  const written = input.trim();

  if (written === "") {
    return { ok: false, reason: "empty" };
  }

  if (!WRITTEN_PHONE.test(written)) {
    return { ok: false, reason: "not_a_number" };
  }

  const digits = written.replace(/[^0-9]/g, "");

  if (digits === "") {
    return { ok: false, reason: "not_a_number" };
  }

  let international: string;
  if (written.startsWith("+")) {
    international = digits;
  } else if (digits.startsWith("00")) {
    international = digits.slice(2);
  } else if (digits.startsWith("0")) {
    international = SERBIA_COUNTRY_CODE + digits.slice(1);
  } else if (digits.startsWith(SERBIA_COUNTRY_CODE)) {
    international = digits;
  } else {
    international = SERBIA_COUNTRY_CODE + digits;
  }

  // `+381 064 …` — nula iza pozivnog broja je česta greška u kucanju, a broj
  // je inače tačan.
  if (international.startsWith(`${SERBIA_COUNTRY_CODE}0`)) {
    international =
      SERBIA_COUNTRY_CODE +
      international.slice(SERBIA_COUNTRY_CODE.length + 1);
  }

  if (!international.startsWith(SERBIA_COUNTRY_CODE)) {
    // I dalje razlikuje "ovo uopšte nije broj" (npr. `+0...`, nijedna zemlja
    // nema pozivni koji počinje nulom) od "ovo je stran broj" — prva poruka
    // je tačnija za očiglednu grešku u kucanju.
    const result = validate(international);
    return !result.ok && result.reason === "not_a_number"
      ? result
      : { ok: false, reason: "foreign" };
  }

  const national = international.slice(SERBIA_COUNTRY_CODE.length);

  if (national.length < SERBIA_NATIONAL_MIN) {
    return { ok: false, reason: "too_short" };
  }

  if (national.length > SERBIA_NATIONAL_MAX) {
    return { ok: false, reason: "too_long" };
  }

  if (looksFake(national)) {
    return { ok: false, reason: "looks_fake" };
  }

  return validate(international);
}

function validate(international: string): PhoneNormalization {
  const e164 = `+${international}`;

  if (/^(\d)\1+$/.test(international)) {
    return { ok: false, reason: "looks_fake" };
  }

  if (E164.test(e164)) {
    return { ok: true, e164 };
  }

  if (!/^[1-9]/.test(international)) {
    return { ok: false, reason: "not_a_number" };
  }

  return international.length < 8
    ? { ok: false, reason: "too_short" }
    : { ok: false, reason: "too_long" };
}
