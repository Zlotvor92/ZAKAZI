import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const rowsSchema = z.array(
  z.object({ slug: z.string(), updated_at: z.string() }),
);

export type IndexableSalon = { slug: string; updatedAt: Date };

/**
 * Saloni čije stranice idu u mapu sajta. Pretraživač nije prijavljen, pa
 * bi RLS vratio prazan spisak; zato ide `service_role`, a bira se isto što i
 * stranica za zakazivanje: uključeno zakazivanje i salon koji nije pauziran.
 */
export async function getIndexableSalons(): Promise<IndexableSalon[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("tenants")
    .select("slug, updated_at")
    .eq("public_booking_enabled", true)
    .is("suspended_at", null)
    .order("slug");

  if (error) {
    throw new Error(
      `Čitanje salona za mapu sajta nije uspelo: ${error.message}`,
    );
  }

  return rowsSchema
    .parse(data)
    .map((row) => ({ slug: row.slug, updatedAt: new Date(row.updated_at) }));
}
