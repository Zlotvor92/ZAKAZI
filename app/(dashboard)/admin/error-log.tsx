"use client";

import { useState } from "react";
import type { ErrorRow } from "@/lib/db/errors";
import { pluralize } from "@/lib/domain/plural";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";

function when(value: string): string {
  const date = new Date(value);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const time = date.toLocaleTimeString("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${day}.${month}. ${time}`;
}

/**
 * Spisak grešaka, sklopljen tako da se prvo vidi šta i gde, a stek tek na
 * dodir. Bez toga bi jedna zapetljana greška zauzela ceo ekran i sakrila
 * ostalih deset.
 */
function Row({ row }: { row: ErrorRow }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-border border-t py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {when(row.occurred_at)}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs",
            row.source === "server"
              ? "bg-destructive/10 text-destructive"
              : "bg-accent text-accent-foreground",
          )}
        >
          {row.source === "server"
            ? sr.admin.errors.server
            : sr.admin.errors.client}
        </span>
      </div>

      <p className="pt-1 text-sm break-words">{row.message}</p>

      {row.path ? (
        <p className="text-muted-foreground truncate text-xs">{row.path}</p>
      ) : null}

      {row.stack ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-muted-foreground inline-flex min-h-11 items-center text-xs underline"
          >
            {open ? sr.admin.errors.hide : sr.admin.errors.show}
          </button>
          {open ? (
            <pre className="bg-muted mt-1 overflow-x-auto rounded-md p-2 text-[11px] leading-relaxed">
              {row.stack}
            </pre>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

export function ErrorLog({ rows }: { rows: ErrorRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{sr.admin.errors.empty}</p>
    );
  }

  return (
    <ul>
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </ul>
  );
}

/** Ćuti kad grešaka nema — isto pravilo kao kod trake za kopiju baze. */
export function ErrorBanner({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }

  return (
    <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-xl border p-3">
      <p className="text-sm font-medium">
        {sr.admin.errors.bannerTitle.replace(
          "{broj}",
          `${count} ${pluralize(count, sr.admin.errors.count)}`,
        )}
      </p>
      <p className="text-sm">{sr.admin.errors.bannerBody}</p>
    </div>
  );
}
