"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  blockClient,
  changeStatus,
  type ActionState,
} from "@/app/(dashboard)/dashboard/actions";
import type {
  AppointmentStatus,
  DashboardAppointment,
} from "@/lib/db/appointments";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";

/** Statusi koji su završena priča i zato izbledeli u spisku. */
const SETTLED = new Set<AppointmentStatus>(["completed", "no_show"]);

type Action = { label: string; status: AppointmentStatus };

/**
 * Šta se nudi zavisi od toga gde je termin. `completed` i `no_show` smeju
 * jedno u drugo, jer je pogrešan dodir na telefonu svakodnevica, a pogrešno
 * upisan nedolazak kasnije nekoga košta.
 */
function actionsFor(status: AppointmentStatus): Action[] {
  switch (status) {
    case "pending":
      return [
        { label: sr.dashboard.confirm, status: "confirmed" },
        { label: sr.dashboard.cancel, status: "cancelled_by_salon" },
      ];
    case "confirmed":
      return [
        { label: sr.dashboard.arrived, status: "completed" },
        { label: sr.dashboard.noShow, status: "no_show" },
        { label: sr.dashboard.cancel, status: "cancelled_by_salon" },
      ];
    case "completed":
      return [{ label: sr.dashboard.noShow, status: "no_show" }];
    case "no_show":
      return [{ label: sr.dashboard.arrived, status: "completed" }];
    default:
      return [];
  }
}

function Row({
  appointment,
  timeZone,
}: {
  appointment: DashboardAppointment;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ActionState>) {
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : result.message);
      setArmed(false);
      router.refresh();
    });
  }

  const actions = actionsFor(appointment.status);

  return (
    <li className={cn("py-1", SETTLED.has(appointment.status) && "opacity-60")}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 py-2 text-left"
      >
        <span className="w-12 shrink-0 text-sm tabular-nums">
          <span className="block font-medium">
            {formatInTimeZone(new Date(appointment.start_at), timeZone, "HH:mm")}
          </span>
          <span className="text-muted-foreground block text-xs">
            {formatInTimeZone(new Date(appointment.end_at), timeZone, "HH:mm")}
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {appointment.client_name}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            {appointment.service_name}
            {appointment.source === "public"
              ? ` · ${sr.dashboard.fromPublicPage}`
              : ""}
          </span>
        </span>

        <span className="text-muted-foreground shrink-0 text-right text-xs">
          {sr.appointmentStatus[appointment.status]}
        </span>
      </button>

      {open ? (
        <div className="space-y-2 pb-3 pl-15">
          <div className="flex flex-wrap gap-2">
            <a
              href={`tel:${appointment.client_phone}`}
              className="border-border hover:bg-accent inline-flex h-9 items-center rounded-md border px-3 text-sm"
            >
              {sr.dashboard.call}
            </a>

            {actions.map((action) => (
              <Button
                key={action.status}
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => run(() => changeStatus(appointment.id, action.status))}
              >
                {action.label}
              </Button>
            ))}

            {/* Dva dodira namerno: blokada je teška odluka, promašen prst nije. */}
            <Button
              type="button"
              variant={armed ? "default" : "ghost"}
              size="sm"
              disabled={pending}
              onClick={() =>
                armed ? run(() => blockClient(appointment.id)) : setArmed(true)
              }
            >
              {armed ? sr.dashboard.blockConfirm : sr.dashboard.block}
            </Button>
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function DayList({
  appointments,
  timeZone,
}: {
  appointments: DashboardAppointment[];
  timeZone: string;
}) {
  return (
    <ul className="divide-border divide-y">
      {appointments.map((appointment) => (
        <Row
          key={appointment.id}
          appointment={appointment}
          timeZone={timeZone}
        />
      ))}
    </ul>
  );
}
