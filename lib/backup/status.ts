import { z } from "zod";
import type { BackupRun } from "@/lib/domain/backup-health";

/**
 * Repo je javan, pa se poslednji prolaz čita bez ijednog ključa. Time konzola
 * nema šta da čuva ni da rotira zbog jedne trake.
 */
const RUNS_URL =
  "https://api.github.com/repos/Zlotvor92/ZAKAZI/actions/workflows/backup.yml/runs?per_page=1";

/** Neprijavljen poziv ka GitHub-u ima sat limit, a odgovor se menja jednom dnevno. */
const CACHE_SECONDS = 900;

const runsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      conclusion: z.string().nullable(),
      run_started_at: z.string(),
    }),
  ),
});

/**
 * `null` kad se stanje ne može pročitati — mreža, limit, izmenjen odgovor.
 * Konzola to prikazuje kao „ne znam", nikada kao „sve je u redu": tiho
 * uspešno stanje na osnovu neuspele provere je gore nego nikakva traka.
 */
export async function getLastBackupRun(): Promise<BackupRun | null> {
  try {
    const response = await fetch(RUNS_URL, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: CACHE_SECONDS },
    });

    if (!response.ok) {
      return null;
    }

    const runs = runsSchema.parse(await response.json()).workflow_runs;
    const last = runs[0];

    return last === undefined
      ? null
      : { conclusion: last.conclusion, startedAt: last.run_started_at };
  } catch {
    return null;
  }
}
