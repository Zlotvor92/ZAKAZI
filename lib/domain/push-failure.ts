export type PushFailure = {
  /** `service`: pregledač nije stigao do push servisa; `browser`: sve ostalo. */
  kind: "service" | "browser";
  name: string;
  /** Tekst za evidenciju grešaka; stane u limit rute `/api/greske`. */
  report: string;
};

const REPORT_LIMIT = 500;

/**
 * Razvrstava grešku pri pretplati na obaveštenja.
 *
 * `AbortError` iz `pushManager.subscribe` znači da pregledač nije uspeo da
 * registruje uređaj kod push servisa (Chrome: „push service error"). Dozvola je
 * tada već data, pa poruka „telefon nije dozvolio" govori suprotno od istine.
 * Ime greške nije dovoljno da se uzrok utvrdi, zato i `message` ide u evidenciju.
 */
export function classifyPushFailure(cause: unknown): PushFailure {
  const name = cause instanceof Error ? cause.name : "";
  const message = cause instanceof Error ? cause.message : String(cause);

  return {
    kind: name === "AbortError" ? "service" : "browser",
    name,
    report: `Pretplata na obaveštenja nije uspela: ${name || "bez imena"}: ${message}`.slice(
      0,
      REPORT_LIMIT,
    ),
  };
}
