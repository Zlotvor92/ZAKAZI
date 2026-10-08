import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const rowsSchema = z.array(
  z.object({ slug: z.string(), updated_at: z.string() }),
);

export type IndexableSalon = { slug: string; updatedAt: Date };

/**
 * Saloni čije stranice idu u mapu sajta. Pretraživač nije prijavljen, pa
 * bi RLS vratio prazan spisak; zato ide `service_role`.
 *
 * Uslovi su u bazi (`indexable_salons`), iste kao oni po kojima se odlučuje da
 * li je javna strana otvorena: zakazivanje uključeno, salon nije pauziran,
 * pristup nije istekao i postoji usluga koja može da se zakaže.
 */
export async function getIndexableSalons(): Promise<IndexableSalon[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("indexable_salons");

  if (error) {
    throw new Error(
      `Čitanje salona za mapu sajta nije uspelo: ${error.message}`,
    );
  }

  return rowsSchema
    .parse(data)
    .map((row) => ({ slug: row.slug, updatedAt: new Date(row.updated_at) }));
}
