const SERBIA_COUNTRY_CODE = "381";

/**
 * Nacionalni broj u Srbiji je 8 ili 9 cifara pošto se odbaci nula ispred:
 * 064 123 456 i 064 123 4567 su oba u upotrebi, kao i 011 234 5678.
 */
const SERBIA_NATIONAL_MIN = 8;
const SERBIA_NATIONAL_MAX = 9;

/** Ista provera koju radi ograničenje `clients_phone_e164_format` u bazi. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Razmak, crta, kosa crta, tačka i zagrada su način na koji ljudi pišu broj. */
const WRITTEN_PHONE = /^\+?[0-9\s()./-]+$/;

export type PhoneProblem = "empty" | "not_a_number" | "too_short" | "too_long";

export type PhoneNormalization =
  | { ok: true; e164: string }
  | { ok: false; reason: PhoneProblem };

/**
 * Broj kako ga je neko otkucao pretvara u E.164. Podrazumevana zemlja je
 * Srbija, pa `0641234567` i `641234567` daju isto što i `+381641234567` —
 * strani broj mora da nosi `+`, inače se čita kao domaći i ispadne predugačak.
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
    return validate(international);
  }

  const national = international.slice(SERBIA_COUNTRY_CODE.length);

  if (national.length < SERBIA_NATIONAL_MIN) {
    return { ok: false, reason: "too_short" };
  }

  if (national.length > SERBIA_NATIONAL_MAX) {
    return { ok: false, reason: "too_long" };
  }

  return validate(international);
}

function validate(international: string): PhoneNormalization {
  const e164 = `+${international}`;

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
