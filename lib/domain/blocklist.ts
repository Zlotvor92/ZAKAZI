type Blocked = { phone_e164: string };
type KnownClient = { phone_e164: string; name: string };

/** Ime klijentkinje uz blokiran broj, da se vlasnica snađe kad hoće da odblokira. */
export function withClientNames<T extends Blocked>(
  blocked: T[],
  clients: KnownClient[],
): (T & { client_name: string | null })[] {
  const names = new Map(clients.map((client) => [client.phone_e164, client.name]));

  return blocked.map((entry) => ({
    ...entry,
    client_name: names.get(entry.phone_e164) ?? null,
  }));
}
