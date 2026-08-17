import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const blockedSchema = z.object({
  id: z.uuid(),
  phone_e164: z.string(),
  reason: z.string().nullable(),
  created_at: z.string(),
});

export type BlockedNumber = z.infer<typeof blockedSchema>;

/** Blokirani brojevi izabranog salona. Blokada važi po salonu, ne po nalogu. */
export async function getBlockedNumbers(
  tenantId: string,
): Promise<BlockedNumber[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("blocklist")
    .select("id, phone_e164, reason, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Čitanje blokiranih brojeva nije uspelo: ${error.message}`);
  }

  return z.array(blockedSchema).parse(data);
}

export async function blockNumber(input: {
  tenantId: string;
  phoneE164: string;
  reason: string | null;
}): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("blocklist").upsert(
    {
      tenant_id: input.tenantId,
      phone_e164: input.phoneE164,
      reason: input.reason,
    },
    { onConflict: "tenant_id,phone_e164", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`Blokiranje broja nije uspelo: ${error.message}`);
  }
}

export async function unblockNumber(id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("blocklist").delete().eq("id", id);

  if (error) {
    throw new Error(`Odblokiranje nije uspelo: ${error.message}`);
  }
}
