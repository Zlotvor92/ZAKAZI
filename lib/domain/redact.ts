/**
 * Putanja koja ide u evidenciju grešaka. Token kalendara salona je jedini
 * dokaz za čitanje imena i brojeva svih klijentkinja, pa ne sme da završi u
 * bazi grešaka ni u tuđem logu: menja se oznakom, `.ics` ostaje.
 */
const CALENDAR_FEED = /^(\/api\/kalendar\/salon\/)[^/?#]+?(\.ics)?(?=$|[/?#])/;

export function redactErrorPath(path: string): string;
export function redactErrorPath(path: string | null | undefined): string | null;
export function redactErrorPath(path: string | null | undefined): string | null {
  if (path == null) {
    return null;
  }

  return path.replace(CALENDAR_FEED, (_match, prefix: string, ext?: string) =>
    `${prefix}[token]${ext ?? ""}`,
  );
}
