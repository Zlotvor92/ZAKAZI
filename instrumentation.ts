import type { Instrumentation } from "next";

/**
 * Zvanični priključak za greške na serveru.
 *
 * Hvata sve što padne izvan dohvata granice greške u pregledaču: server
 * komponente, server akcije, rute, middleware. Do danas su te greške
 * završavale isključivo u Vercelovom logu, koji na besplatnom planu čuva
 * jedan sat i koji niko ne gleda dok se neko ne požali.
 *
 * Uvoz je odložen namerno: ovaj modul se učitava pri podizanju servera, a
 * povlačenje pristupa bazi u tom trenutku odlaže hladan start svakoj ruti.
 */
/** Zaglavlje ume da stigne i kao lista, kad ga posrednik pošalje dvaput. */
function userAgent(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
) => {
  const { logError } = await import("@/lib/db/errors");

  const cause = error instanceof Error ? error : new Error(String(error));

  await logError({
    source: "server",
    message: cause.message,
    digest: "digest" in cause ? String(cause.digest) : null,
    path: request.path,
    stack: cause.stack ?? null,
    userAgent: userAgent(request.headers["user-agent"]),
  });
};
