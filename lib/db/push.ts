import { z } from "zod";
import { isAllowedPushEndpoint } from "@/lib/domain/push-endpoint";
import { createClient } from "@/lib/supabase/server";

/**
 * Oblik koji pregledač vrati iz `PushManager.subscribe`.
 *
 * `endpoint` mora biti push servis pregledača: server šalje POST na njega, pa
 * bi proizvoljan host bio odlazni zahtev na adresu koju bira korisnik. Ista
 * provera stoji i u bazi, jer ova ovde važi samo za pozive kroz aplikaciju.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(1000)
    .refine(isAllowedPushEndpoint, { message: "Nepoznat push servis." }),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/**
 * Pamti uređaj koji prima obaveštenja za jedan salon.
 *
 * Ključ je (salon, `endpoint`), ne sam `endpoint`: isti pregledač ume da vrati
 * isti `endpoint` posle ponovnog uključivanja, pa se pretplata ne sme
 * gomilati, ali isti telefon sme da prati dva salona istog korisnika.
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
    { onConflict: "tenant_id,endpoint" },
  );

  if (error) {
    throw new Error(`Upis pretplate nije uspeo: ${error.message}`);
  }
}

/**
 * Gasi obaveštenja za jedan salon i vraća koliko drugih salona isti uređaj
 * još prati. Pregledačku pretplatu sme da ugasi samo onaj ko dobije nulu:
 * ona je zajednička svim salonima na tom telefonu.
 */
export async function removePushSubscription(input: {
  tenantId: string;
  endpoint: string;
}): Promise<{ remainingElsewhere: number }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("endpoint", input.endpoint);

  if (error) {
    throw new Error(`Gašenje obaveštenja nije uspelo: ${error.message}`);
  }

  const { count, error: countError } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("endpoint", input.endpoint);

  if (countError) {
    throw new Error(`Čitanje pretplata nije uspelo: ${countError.message}`);
  }

  return { remainingElsewhere: count ?? 0 };
}

/**
 * Da li server za ovaj salon i ovaj uređaj ima pretplatu. Pregledač sam zna
 * samo da je pretplaćen, ne i da je server to zapisao — pa ekran sme da kaže
 * „uključeno" tek kad ovo potvrdi.
 */
export async function hasPushSubscription(input: {
  tenantId: string;
  endpoint: string;
}): Promise<boolean> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .eq("endpoint", input.endpoint);

  if (error) {
    throw new Error(`Čitanje pretplata nije uspelo: ${error.message}`);
  }

  return (count ?? 0) > 0;
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
