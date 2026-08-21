/**
 * Ponovljeni pokušaj kad PostgREST odbije tek izdat token.
 *
 * Token izdaje Supabase Auth svojim satom, a PostgREST ga proverava svojim i
 * pri tome sam prašta trideset sekundi razlike. Kad PostgREST zaostane više od
 * toga, svež token mu izgleda kao izdat u budućnosti: vraća 401 sa porukom
 * „JWT issued at future" i ne dodiruje bazu. Isti token prolazi čim njegov sat
 * stigne.
 *
 * Pogađa tačno jedan zahtev na sat — onaj u kome middleware osveži sesiju, jer
 * je token tada star nekoliko stotina milisekundi. Do sada je taj zahtev rušio
 * ceo `/dashboard`.
 *
 * Sat je na Supabase-ovoj strani i odavde se ne može podesiti; ovo samo hvata
 * razmak dok ne stigne. Kad čekanje ne pomogne, greška ide u konzolu kao i pre
 * — i tada se prijavljuje Supabase-u, jer je uzrok tamo.
 */

/** Poruka kojom PostgREST odbija token izdat ispred svog sata. */
const ISSUED_AT_FUTURE = "JWT issued at future";

/**
 * Pauze pred svaki naredni pokušaj. Kratke namerno: čeka se da tuđ sat stigne,
 * a strana koja se učitava pet sekundi je i dalje bolja od strane koja pukne.
 */
export const CLOCK_SKEW_DELAYS_MS = [500, 1500, 3000];

/**
 * Da li je odgovor baš to odbijanje.
 *
 * Uslov je namerno uzak. Istekao token, pogrešan potpis i sve ostalo što vraća
 * 401 ne prolazi ni posle čekanja, pa se ne ponavlja — ponavljanje bi tu samo
 * usporilo poruku koja je već tačna.
 */
export function tokenIssuedInFuture(status: number, body: string): boolean {
  return status === 401 && body.includes(ISSUED_AT_FUTURE);
}

const passThrough: typeof fetch = (input, init) => fetch(input, init);

/**
 * Isti `fetch`, koji to jedno odbijanje ponovi umesto da ga prosledi dalje.
 *
 * Ponavljanje je bezbedno i za upis: 401 stiže iz provere tokena, pre nego što
 * PostgREST uopšte otvori vezu ka bazi, pa prvi pokušaj nije mogao ništa da
 * upiše.
 */
export function withClockSkewRetry(
  inner: typeof fetch = passThrough,
  delaysMs: readonly number[] = CLOCK_SKEW_DELAYS_MS,
): typeof fetch {
  return async (input, init) => {
    let response = await inner(input, init);

    for (const delay of delaysMs) {
      if (!(await rejectedForSkew(response))) {
        return response;
      }

      await wait(delay);
      response = await inner(input, init);
    }

    return response;
  };
}

/** Telo se čita sa kopije, da original ostane netaknut za pozivaoca. */
async function rejectedForSkew(response: Response): Promise<boolean> {
  if (response.status !== 401) {
    return false;
  }

  try {
    return tokenIssuedInFuture(response.status, await response.clone().text());
  } catch {
    return false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
