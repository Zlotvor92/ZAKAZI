import { redactErrorPath } from "./redact";

const KEEP = ["effective-directive", "violated-directive", "disposition"] as const;

/**
 * Adresa svedena na izvor i putanju. Upit i fragment mogu da nose tajne, a
 * putanja kalendara salona ima token, pa se i ona prolazi kroz `redactErrorPath`.
 * Šeme koje nisu adresa (`inline`, `eval`, `data`) ostaju kakve jesu.
 */
export function stripUrl(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    return "-";
  }

  try {
    const url = new URL(value);
    return `${url.origin}${redactErrorPath(url.pathname)}`;
  } catch {
    return value.slice(0, 40);
  }
}

/** Jedna poruka za evidenciju grešaka, bez ičeg što bi nosilo korisnikov podatak. */
export function cspReportMessage(body: Record<string, unknown>): string {
  const directive =
    KEEP.map((key) => body[key]).find((value) => typeof value === "string") ??
    "?";

  const blocked = stripUrl(body["blocked-uri"] ?? body["blockedURL"]);
  const document = stripUrl(body["document-uri"] ?? body["documentURL"]);

  return `CSP ${String(directive)}: blokirano ${blocked} na ${document}`.slice(
    0,
    500,
  );
}

/**
 * Pregledač unutar Instagram/Facebook aplikacije sam ubacuje Meta skriptu u
 * svaku stranicu. Nije naš kod i nije nešto što možemo da popravimo, pa ne
 * ide u evidenciju grešaka.
 */
const IGNORED_BLOCKED_ORIGINS = new Set(["https://connect.facebook.net"]);

export function isIgnoredCspReport(body: Record<string, unknown>): boolean {
  const blocked = body["blocked-uri"] ?? body["blockedURL"];
  if (typeof blocked !== "string") {
    return false;
  }

  try {
    return IGNORED_BLOCKED_ORIGINS.has(new URL(blocked).origin);
  } catch {
    return false;
  }
}
