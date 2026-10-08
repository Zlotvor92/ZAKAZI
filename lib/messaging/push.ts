import webpush from "web-push";
import { logError } from "@/lib/db/errors";
import { requireEnv } from "@/lib/env";
import { isAllowedPushEndpoint } from "@/lib/domain/push-endpoint";
import { createAdminClient } from "@/lib/supabase/admin";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  /**
   * Oznaka pod kojom telefon drži obaveštenje.
   *
   * Dva obaveštenja sa istom oznakom se ne ređaju — drugo tiho zameni prvo,
   * bez zvuka i vibracije. Dok je oznaka bila adresa, zakazivanje i
   * otkazivanje istog termina imali su istu (`/dashboard?dan=…`), pa je
   * otkazivanje nestajalo preko zakazivanja. Isto se dešavalo i sa dva
   * zakazivanja za isti dan.
   */
  tag: string;
};

/**
 * Podrazumevana hitnost je `normal`, a FCM takvu poruku na Androidu u Doze
 * režimu drži dok telefon ne bude aktivan: server dobije 201, a vlasnica ništa
 * ne vidi. `high` budi telefon odmah. Svaka poruka ovde postaje vidljivo
 * obaveštenje, pa je to jedini dozvoljen način da se koristi.
 *
 * Rok od dana: zakazivanje starije od toga vlasnica ionako vidi u kalendaru, a
 * telefon koji je ceo dan ugašen ne sme da zaspe stotinu starih poruka.
 */
export const SEND_OPTIONS = { urgency: "high", TTL: 24 * 60 * 60 } as const;

/** Uređaj koji je pretplaćen, u obliku koji `web-push` očekuje. */
type Target = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

let configured = false;

function configure(): void {
  if (configured) {
    return;
  }

  webpush.setVapidDetails(
    requireEnv("VAPID_SUBJECT"),
    requireEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    requireEnv("VAPID_PRIVATE_KEY"),
  );
  configured = true;
}

/**
 * Da li je pretplata mrtva.
 *
 * 404 i 410 znače da je uređaj otkazao pretplatu ili da je pregledač obrisao
 * podatke. Takva se briše — inače spisak raste, a svako slanje čeka na uređaj
 * koji više ne postoji.
 */
function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: number }).statusCode;
  return status === 404 || status === 410;
}

type DeliveryStatus = "sent" | "failed" | "expired";

/**
 * Šalje poruku na uređaje salona i upisuje svaku u `messages`. Vraća ishod po
 * uređaju, ili `null` kad ključevi nisu podešeni ili čitanje spiska padne.
 *
 * Endpoint koji nije push servis pregledača se ne zove: red je mogao ući pre
 * nego što je baza počela da ih proverava, a server ne sme da šalje na
 * proizvoljan host. Takav uređaj se računa kao neuspeo i ne briše se.
 */
async function deliver(input: {
  tenantId: string;
  appointmentId: string | null;
  payload: PushPayload;
  template: string;
  /** Samo uređaji jednog korisnika — za probno obaveštenje. */
  userId?: string;
}): Promise<DeliveryStatus[] | null> {
  try {
    configure();
  } catch {
    // Ključevi nisu podešeni — salon prosto nema obaveštenja.
    return null;
  }

  const supabase = createAdminClient();

  const query = supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("tenant_id", input.tenantId);

  const { data, error } = await (input.userId === undefined
    ? query
    : query.eq("user_id", input.userId));

  if (error || !data || data.length === 0) {
    return error ? null : [];
  }

  // Pretplata pripada uređaju, ne članstvu: korisnica koja se odjavila ili je
  // izgubila pristup salonu ne sme da dobija ime klijentkinje i vreme termina
  // na telefon. Članstvo se proverava pri svakom slanju, pa ne zavisi od toga
  // da li je neko pretplatu obrisao.
  const targets = data as Target[];
  const { data: members, error: membersError } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", input.tenantId)
    .in("user_id", [...new Set(targets.map((target) => target.user_id))]);

  if (membersError || !members) {
    return null;
  }

  const memberIds = new Set(
    (members as { user_id: string }[]).map((member) => member.user_id),
  );
  const orphaned = targets.filter((target) => !memberIds.has(target.user_id));
  const eligible = targets.filter((target) => memberIds.has(target.user_id));

  if (orphaned.length > 0) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .in(
        "id",
        orphaned.map((target) => target.id),
      );
  }

  if (eligible.length === 0) {
    return [];
  }

  const body = JSON.stringify(input.payload);
  const dead: string[] = [];

  const results = await Promise.all(
    eligible.map(async (target): Promise<DeliveryStatus> => {
      if (!isAllowedPushEndpoint(target.endpoint)) {
        await logError({
          source: "server",
          message: "Push nije poslat: endpoint nije push servis pregledača.",
        });
        return "failed";
      }

      try {
        await webpush.sendNotification(
          {
            endpoint: target.endpoint,
            keys: { p256dh: target.p256dh, auth: target.auth },
          },
          body,
          SEND_OPTIONS,
        );
        return "sent";
      } catch (sendError) {
        if (isGone(sendError)) {
          dead.push(target.id);
          return "expired";
        }

        // Razlog je jedino što govori da li je pao servis pregledača (5xx),
        // ključ (401/403) ili poruka (413); u `messages` stoji samo „failed".
        const code = (sendError as { statusCode?: number }).statusCode;
        await logError({
          source: "server",
          message: `Push nije isporučen: ${code ? `HTTP ${code}` : "bez odgovora servisa"}.`,
        });
        return "failed";
      }
    }),
  );

  await supabase.from("messages").insert(
    results.map((status) => ({
      tenant_id: input.tenantId,
      appointment_id: input.appointmentId,
      channel: "push",
      template: input.template,
      status,
      cost_estimate: 0,
    })),
  );

  if (dead.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", dead);
  }

  return results;
}

/**
 * Šalje obaveštenje na sve uređaje salona i upisuje šta se desilo.
 *
 * Ne baca. Zakazivanje je već upisano u bazu kad se ovo pozove; pad slanja ne
 * sme da postane pad zakazivanja, jer bi klijentkinja videla grešku za termin
 * koji je zapravo njen.
 */
export async function notifyTenant(input: {
  tenantId: string;
  appointmentId: string;
  payload: PushPayload;
  template: string;
}): Promise<void> {
  await deliver(input);
}

export type TestPushResult =
  | { status: "accepted"; devices: number }
  | { status: "no_devices" }
  | { status: "failed" }
  | { status: "unavailable" };

/**
 * Probno obaveštenje koje korisnik sam pokreće, samo na svoje uređaje.
 *
 * `accepted` znači da je push servis pregledača primio poruku, ne da je stigla
 * na ekran: servis ne javlja isporuku, pa ovo ne sme da se prikaže kao
 * potvrda prijema.
 */
export async function sendTestPush(input: {
  tenantId: string;
  userId: string;
  payload: PushPayload;
}): Promise<TestPushResult> {
  const results = await deliver({
    tenantId: input.tenantId,
    userId: input.userId,
    appointmentId: null,
    payload: input.payload,
    template: "test",
  });

  if (results === null) {
    return { status: "unavailable" };
  }

  if (results.length === 0) {
    return { status: "no_devices" };
  }

  const accepted = results.filter((status) => status === "sent").length;

  return accepted > 0
    ? { status: "accepted", devices: accepted }
    : { status: "failed" };
}
