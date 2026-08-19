/**
 * Stanje noćne kopije baze, onako kako ga vidi vlasnik platforme.
 *
 * - `ok` — poslednja kopija je uspela i dovoljno je sveža
 * - `running` — posao upravo radi, nema šta da se javlja
 * - `failed` — poslednji prolaz je pao
 * - `stale` — poslednji prolaz je uspeo, ali je prestar: kopije nema
 * - `unknown` — stanje se ne može pročitati
 *
 * `stale` postoji zato što je pad posla lak slučaj — on je glasan. Opasno je
 * ćutanje: GitHub sam gasi zakazane poslove posle dužeg mirovanja repoa, i
 * tada kopije prosto prestanu, bez ijedne greške koju bi neko video.
 */
export type BackupState = "ok" | "running" | "failed" | "stale" | "unknown";

/** Poslednji poznati prolaz posla, sveden na ono što odluka traži. */
export type BackupRun = {
  /** `success`, `failure`, `cancelled`… `null` dok prolaz još traje. */
  conclusion: string | null;
  /** Kad je prolaz počeo, ISO 8601. */
  startedAt: string;
};

/**
 * Posao ide jednom dnevno. Dvadeset šest sati daje prostora da se zakazivanje
 * pomeri za koji sat, a da se ne javlja lažna uzbuna.
 */
export const STALE_AFTER_HOURS = 26;

export function backupState(
  run: BackupRun | null,
  now: Date,
  staleAfterHours: number = STALE_AFTER_HOURS,
): BackupState {
  if (run === null) {
    return "unknown";
  }

  const startedAt = Date.parse(run.startedAt);
  if (Number.isNaN(startedAt)) {
    return "unknown";
  }

  const hours = (now.getTime() - startedAt) / 3_600_000;

  // Prolaz koji traje danima nije prolaz u toku nego zaglavljen posao.
  if (run.conclusion === null) {
    return hours > staleAfterHours ? "stale" : "running";
  }

  // Pad se javlja i kad je star: on je to što treba popraviti, a starost je
  // samo posledica toga što od pada niko nije ni pokušao ponovo.
  if (run.conclusion !== "success") {
    return "failed";
  }

  return hours > staleAfterHours ? "stale" : "ok";
}

/** Koliko je sati prošlo od poslednjeg prolaza; za tekst upozorenja. */
export function hoursSince(run: BackupRun, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(run.startedAt)) / 3_600_000);
}
