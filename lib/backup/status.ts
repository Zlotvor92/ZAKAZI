import { z } from "zod";
import type { BackupRun } from "@/lib/domain/backup-health";

/**
 * Repo je javan, pa se poslednji prolaz čita bez ijednog ključa. Time konzola
 * nema šta da čuva ni da rotira zbog jedne trake.
 */
const RUNS_URL =
  "https://api.github.com/repos/Zlotvor92/ZAKAZI/actions/workflows/backup.yml/runs?per_page=1";

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
    /*
     * Bez keša, iako je poziv neprijavljen i GitHub mu meri sat limit.
     *
     * `next: { revalidate }` prvo vrati stari odgovor pa ga tek onda osveži u
     * pozadini. Ovu stranu otvara jedan čovek i to retko, pa je „stari
     * odgovor" onaj od prošlog otvaranja, ma koliko rok bio kratak: traka je
     * javljala da kopije nema 28 sati dok je noćni posao te iste noći uredno
     * prošao. Traka koja kasni jedno otvaranje nije provera nego šum, a od
     * šuma se nauči da se ne gleda.
     *
     * Limit ovo ne dodiruje jer stranu otvara samo vlasnik platforme. Kad bi
     * ga i dodirnulo, `null` niže znači „ne znam", nikad „sve je u redu".
     */
    const response = await fetch(RUNS_URL, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
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
