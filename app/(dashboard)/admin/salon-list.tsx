"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { AdminSalon } from "@/lib/db/admin";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";
import { enterSalon, toggleSalon, type AdminState } from "./actions";

function formatDate(value: string): string {
  const date = new Date(value);
  const month = sr.calendar.months[date.getMonth()];

  return `${date.getDate()}. ${month}`;
}

function Row({ salon }: { salon: AdminSalon }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AdminState>({ status: "idle" });

  return (
    <li className="border-border rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                salon.suspended ? "bg-destructive" : "bg-emerald-500",
              )}
            />
            <h2 className="truncate font-semibold">{salon.name}</h2>
          </div>
          <p className="text-muted-foreground truncate text-sm">
            {salon.owner_email ?? sr.admin.ownerUnknown}
          </p>
          <p className="text-muted-foreground truncate text-xs">/{salon.slug}</p>
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-1 text-xs font-medium",
            salon.suspended
              ? "bg-destructive/10 text-destructive"
              : "bg-accent text-accent-foreground",
          )}
        >
          {salon.suspended ? sr.admin.suspended : sr.admin.active}
        </span>
      </div>

      <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 pt-3 text-xs">
        <div>
          <dd className="inline tabular-nums">{salon.services_count}</dd>{" "}
          <dt className="inline">{sr.admin.servicesCount}</dt>
        </div>
        <div>
          <dd className="inline tabular-nums">{salon.upcoming_count}</dd>{" "}
          <dt className="inline">{sr.admin.upcomingCount}</dt>
        </div>
        <div>
          <dt className="inline">
            {salon.last_booking_at
              ? `${sr.admin.lastBooking} ${formatDate(salon.last_booking_at)}`
              : sr.admin.neverBooked}
          </dt>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2 pt-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await enterSalon(salon.id);
            });
          }}
        >
          {sr.admin.enter}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (
              !salon.suspended &&
              !window.confirm(sr.admin.suspendConfirm)
            ) {
              return;
            }
            startTransition(async () => {
              setState(await toggleSalon(salon.id, !salon.suspended));
            });
          }}
        >
          {salon.suspended ? sr.admin.resume : sr.admin.suspend}
        </Button>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-destructive pt-2 text-sm">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

export function SalonList({ salons }: { salons: AdminSalon[] }) {
  if (salons.length === 0) {
    return <p className="text-muted-foreground text-sm">{sr.admin.empty}</p>;
  }

  return (
    <ul className="space-y-3">
      {salons.map((salon) => (
        <Row key={salon.id} salon={salon} />
      ))}
    </ul>
  );
}
