type Manager = Pick<PushManager, "getSubscription" | "subscribe">;

const RETRY_AFTER_MS = 1500;

function sameKey(current: ArrayBuffer | null, wanted: ArrayBuffer): boolean {
  if (!current || current.byteLength !== wanted.byteLength) {
    return false;
  }

  const a = new Uint8Array(current);
  const b = new Uint8Array(wanted);

  return a.every((byte, index) => byte === b[index]);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pretplata ovog pregledača na push servis.
 *
 * Odjava briše red na serveru, a pregledač ostaje pretplaćen — pa se postojeća
 * pretplata koristi umesto novog `subscribe`, koji je na telefonu jedne
 * korisnice pao sa `AbortError` iako je pretplata već postojala. Koristi se
 * samo ako je ključ isti: pretplata napravljena drugim ključem ne bi primala
 * poruke ovog servera, pa tada `subscribe` sam javlja grešku.
 *
 * `AbortError` znači da pregledač nije stigao do push servisa; drugi pokušaj
 * posle kratke pauze je jedino što korisnica inače radi ručno. Ostale greške se
 * ne ponavljaju: dozvola ili podrška se ne menjaju za sekundu i po.
 */
export async function subscribeDevice(
  manager: Manager,
  key: ArrayBuffer,
  pause: (ms: number) => Promise<void> = wait,
): Promise<PushSubscription> {
  const existing = await manager.getSubscription();

  if (existing && sameKey(existing.options.applicationServerKey, key)) {
    return existing;
  }

  const options = { userVisibleOnly: true, applicationServerKey: key };

  try {
    return await manager.subscribe(options);
  } catch (cause) {
    if (!(cause instanceof Error) || cause.name !== "AbortError") {
      throw cause;
    }

    await pause(RETRY_AFTER_MS);
    return manager.subscribe(options);
  }
}
