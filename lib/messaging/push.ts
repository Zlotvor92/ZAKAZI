import webpush from "web-push";
import { requireEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

/** Uređaj koji je pretplaćen, u obliku koji `web-push` očekuje. */
type Target = {
  id: string;
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
  try {
    configure();
  } catch {
    // Ključevi nisu podešeni — salon prosto nema obaveštenja.
    return;
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("tenant_id", input.tenantId);

  if (error || !data || data.length === 0) {
    return;
  }

  const body = JSON.stringify(input.payload);
  const dead: string[] = [];

  const results = await Promise.all(
    (data as Target[]).map(async (target) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: target.endpoint,
            keys: { p256dh: target.p256dh, auth: target.auth },
          },
          body,
        );
        return "sent" as const;
      } catch (sendError) {
        if (isGone(sendError)) {
          dead.push(target.id);
          return "expired" as const;
        }
        return "failed" as const;
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
}
