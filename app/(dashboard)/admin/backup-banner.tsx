import type { BackupState } from "@/lib/domain/backup-health";
import { sr } from "@/lib/i18n/sr";

const ACTIONS_URL =
  "https://github.com/Zlotvor92/ZAKAZI/actions/workflows/backup.yml";

const TONE: Record<string, string> = {
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  stale: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  unknown: "border-border bg-muted text-muted-foreground",
};

/**
 * Ćuti kad je sve u redu. Traka koja stoji i onda kad nema šta da javi
 * prestane da se primećuje, pa je ne bi bilo ni kad zatreba.
 */
export function BackupBanner({
  state,
  hours,
}: {
  state: BackupState;
  hours: number | null;
}) {
  if (state === "ok" || state === "running") {
    return null;
  }

  const text = sr.admin.backup;
  const content =
    state === "failed"
      ? { title: text.failedTitle, body: text.failedBody }
      : state === "stale"
        ? {
            title: text.staleTitle.replace("{sati}", String(hours ?? "?")),
            body: text.staleBody,
          }
        : { title: text.unknownTitle, body: text.unknownBody };

  return (
    <div
      role="alert"
      className={`mb-4 rounded-md border p-3 ${TONE[state] ?? TONE["unknown"]}`}
    >
      <p className="text-sm font-semibold">{content.title}</p>
      <p className="pt-1 text-sm opacity-90">{content.body}</p>
      <a
        href={ACTIONS_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center text-sm underline"
      >
        {text.link}
      </a>
    </div>
  );
}
