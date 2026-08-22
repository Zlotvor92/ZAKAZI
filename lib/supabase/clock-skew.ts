/**
 * Ponovljeni pokušaj kad PostgREST odbije tek izdat token.
 *
 * Token izdaje Supabase Auth svojim satom, a PostgREST ga proverava svojim i
 * pri tome sam prašta trideset sekundi razlike. Kad PostgREST zaostane više od
 * toga, svež token mu izgleda kao izdat u budućnosti: vraća 401 sa porukom
 * „JWT issued at future" i ne dodiruje bazu. Isti token prolazi čim ostari
 * preko zaostatka.
 *
 * Pogađa tačno jedan zahtev na sat — onaj u kome middleware osveži sesiju, jer
 * je token tada star nekoliko stotina milisekundi. Do sada je taj zahtev rušio
 * ceo `/dashboard`.
 *
 * Mereno na produkciji 21.08: Auth i Postgres su se slagali u 1,5 s, a
 * PostgREST je u tom trenutku zaostajao preko trideset sekundi. Sat je na
 * Supabase-ovoj strani i odavde se ne može podesiti — ovde se čeka da token
 * ostari dovoljno, i meri se koliko PostgREST kasni, da poruka u konzoli bude
 * broj a ne zagonetka.
 */

/** Koliko razlike PostgREST sam prašta pri proveri `iat`, `exp` i `nbf`. */
const TOLERANCE_SECONDS = 30;

/** Poruka kojom PostgREST odbija token izdat ispred svog sata. */
const ISSUED_AT_FUTURE = "JWT issued at future";

/**
 * Pauze pred svaki naredni pokušaj. Svaka pauza stari token za toliko, pa ovih
 * pet sekundi pokriva zaostatak do oko trideset pet. Duže se ne čeka: strana
 * koja visi pola minuta je za vlasnicu isto što i strana koja je pukla, samo
 * sporije.
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

/**
 * `iat` iz tokena kojim je zahtev potpisan, u milisekundama.
 *
 * Potpis se ne proverava: ovo je naš sopstveni token i čita se samo da bi se
 * izmerila njegova starost. `null` kad zaglavlja nose ključ projekta umesto
 * sesije, ili kad token nije u očekivanom obliku.
 */
export function accessTokenIssuedAt(headers: Headers): number | null {
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = bearer?.split(".")[1];

  if (payload === undefined) {
    return null;
  }

  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    const iat =
      typeof claims === "object" && claims !== null && "iat" in claims
        ? (claims as { iat: unknown }).iat
        : null;

    return typeof iat === "number" ? iat * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Za koliko PostgREST najmanje zaostaje, iz starosti odbijenog tokena.
 *
 * Da je odbio token star `n` sekundi, njegov sat je bar `30 + n` sekundi iza
 * onoga kojim je token izdat. Prava razlika je veća, ali donja granica je ono
 * što se sa sigurnošću zna — i dovoljna je za prijavu Supabase-u.
 */
export function lagSeconds(issuedAtMs: number, rejectedAtMs: number): number {
  return Math.floor(
    TOLERANCE_SECONDS + Math.max(0, rejectedAtMs - issuedAtMs) / 1000,
  );
}

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

    return (await rejectedForSkew(response))
      ? withMeasuredLag(response, init)
      : response;
  };
}

/**
 * Poruci dopisuje izmereni zaostatak, jer gola „JWT issued at future" ne kaže
 * ni ko kasni ni koliko — a to je jedino što o ovome treba znati.
 */
async function withMeasuredLag(
  response: Response,
  init: RequestInit | undefined,
): Promise<Response> {
  const issuedAt = accessTokenIssuedAt(new Headers(init?.headers));

  if (issuedAt === null) {
    return response;
  }

  const lag = lagSeconds(issuedAt, Date.now());
  const body: unknown = await response.clone().json().catch(() => null);
  const message =
    typeof body === "object" && body !== null && "message" in body
      ? String((body as { message: unknown }).message)
      : ISSUED_AT_FUTURE;

  return Response.json(
    {
      ...(typeof body === "object" && body !== null ? body : {}),
      message: `${message} (PostgREST zaostaje bar ${lag} s za Supabase Auth-om)`,
    },
    { status: response.status },
  );
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

const passThrough: typeof fetch = (input, init) => fetch(input, init);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
