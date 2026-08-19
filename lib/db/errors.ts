import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type ErrorSource = "client" | "server";

export type ErrorReport = {
  source: ErrorSource;
  message: string;
  digest?: string | null;
  path?: string | null;
  stack?: string | null;
  userAgent?: string | null;
};

/**
 * Upisuje grešku, i sam ne sme da je napravi.
 *
 * Poziva se sa mesta na kojima je nešto već puklo. Ako i upis pukne — baza
 * nedostupna, mreža pala — druga greška ne sme da pregazi prvu ni da obori
 * stranu koja se upravo trudi da prikaže poruku.
 */
export async function logError(report: ErrorReport): Promise<void> {
  try {
    const supabase = await createClient();

    await supabase.rpc("log_error", {
      p_source: report.source,
      p_message: report.message,
      p_digest: report.digest ?? null,
      p_path: report.path ?? null,
      p_stack: report.stack ?? null,
      p_user_agent: report.userAgent ?? null,
      p_tenant_id: null,
    });
  } catch {
    // Namerno tiho.
  }
}

const errorRowSchema = z.object({
  id: z.uuid(),
  occurred_at: z.string(),
  source: z.string(),
  message: z.string(),
  path: z.string().nullable(),
  stack: z.string().nullable(),
});

export type ErrorRow = z.infer<typeof errorRowSchema>;

/** Prazan spisak za svakog ko ne upravlja platformom — baza to rešava. */
export async function getRecentErrors(limit = 50): Promise<ErrorRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("recent_errors", {
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Čitanje grešaka nije uspelo: ${error.message}`);
  }

  return z.array(errorRowSchema).parse(data ?? []);
}

export async function getErrorCountLastDay(): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("error_count_last_day");

  if (error) {
    throw new Error(`Brojanje grešaka nije uspelo: ${error.message}`);
  }

  return z.number().int().parse(data ?? 0);
}
