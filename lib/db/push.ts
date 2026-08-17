import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/** Oblik koji pregledač vrati iz `PushManager.subscribe`. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/**
 * Pamti uređaj koji prima obaveštenja.
 *
 * Isti pregledač ume da vrati isti `endpoint` posle ponovnog uključivanja, pa
 * upis ide preko `endpoint` — inače bi se ista pretplata gomilala i vlasnica
 * dobijala pet istih obaveštenja.
 */
export async function savePushSubscription(input: {
  tenantId: string;
  userId: string;
  subscription: PushSubscriptionInput;
}): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      tenant_id: input.tenantId,
      user_id: input.userId,
      endpoint: input.subscription.endpoint,
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    throw new Error(`Upis pretplate nije uspeo: ${error.message}`);
  }
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) {
    throw new Error(`Gašenje obaveštenja nije uspelo: ${error.message}`);
  }
}

/** Koliko uređaja ovog korisnika prima obaveštenja za dati salon. */
export async function countPushSubscriptions(
  tenantId: string,
): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`Čitanje pretplata nije uspelo: ${error.message}`);
  }

  return count ?? 0;
}
