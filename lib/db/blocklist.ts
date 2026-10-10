import { z } from "zod";
import { withClientNames } from "@/lib/domain/blocklist";
import { createClient } from "@/lib/supabase/server";

const blockedSchema = z.object({
  id: z.uuid(),
  phone_e164: z.string(),
  reason: z.string().nullable(),
  created_at: z.string(),
});

const clientNameSchema = z.object({
  phone_e164: z.string(),
  name: z.string(),
});

export type BlockedNumber = z.infer<typeof blockedSchema> & {
  /** Ime iz kartona klijentkinja ovog salona, ako broj ima karton. */
  client_name: string | null;
};

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

  const blocked = z.array(blockedSchema).parse(data);

  if (blocked.length === 0) {
    return [];
  }

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("phone_e164, name")
    .eq("tenant_id", tenantId)
    .in(
      "phone_e164",
      blocked.map((entry) => entry.phone_e164),
    );

  if (clientsError) {
    throw new Error(
      `Čitanje imena blokiranih klijentkinja nije uspelo: ${clientsError.message}`,
    );
  }

  return withClientNames(blocked, z.array(clientNameSchema).parse(clients));
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
