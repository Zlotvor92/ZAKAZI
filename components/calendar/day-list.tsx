"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  blockClient,
  changeStatus,
  loadHistory,
  type ActionState,
} from "@/app/(dashboard)/dashboard/actions";
import type {
  AppointmentHistoryEntry,
  AppointmentStatus,
  DashboardAppointment,
} from "@/lib/db/appointments";
import type { DayTimeOff } from "@/lib/domain/time-off";
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

/**
 * Jedan red istorije: „14:32 · Potvrđen → Otkazala klijentkinja (klijentkinja)".
 * Prvi zapis nema prethodni status — tada je termin nastao.
 */
function HistoryLine({
  entry,
  timeZone,
}: {
  entry: AppointmentHistoryEntry;
  timeZone: string;
}) {
  const when = formatInTimeZone(
    new Date(entry.created_at),
    timeZone,
    "dd.MM. HH:mm",
  );

  return (
    <li className="text-muted-foreground flex flex-wrap gap-x-1 text-xs">
      <span className="tabular-nums">{when}</span>
      <span aria-hidden>·</span>
      <span>
        {entry.from_status
          ? `${sr.appointmentStatus[entry.from_status]} → ${sr.appointmentStatus[entry.to_status]}`
          : sr.history.created}
      </span>
      <span>({sr.history.actor[entry.actor_type]})</span>
    </li>
  );
}

function History({
  appointmentId,
  timeZone,
}: {
  appointmentId: string;
  timeZone: string;
}) {
  const [loading, startLoading] = useTransition();
  const [entries, setEntries] = useState<AppointmentHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  function toggle() {
    if (shown) {
      setShown(false);
      return;
    }

    setShown(true);

    // Jednom učitano ostaje: istorija se ne menja dok je red otvoren.
    if (entries !== null) {
      return;
    }

    startLoading(async () => {
      const result = await loadHistory(appointmentId);
      if (result.ok) {
        setEntries(result.entries);
        setFailed(null);
      } else {
        setFailed(result.message);
      }
    });
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={shown}
        onClick={toggle}
      >
        {shown ? sr.history.hide : sr.history.show}
      </Button>

      {shown ? (
        loading ? (
          <p className="text-muted-foreground text-xs">{sr.history.loading}</p>
        ) : failed ? (
          <p role="alert" className="text-destructive text-xs">
            {failed}
          </p>
        ) : entries && entries.length > 0 ? (
          <ul className="space-y-0.5">
            {entries.map((entry) => (
              <HistoryLine key={entry.id} entry={entry} timeZone={timeZone} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">{sr.history.empty}</p>
        )
      ) : null}
    </div>
  );
}

function Row({
  appointment,
  timeZone,
}: {
  appointment: DashboardAppointment;
  timeZone: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ActionState>) {
    startTransition(async () => {
      // Bez `router.refresh()`: akcija je pozvala `revalidatePath`, pa svež
      // sadržaj stiže uz njen odgovor. Osvežavanje bi bio pun zahtev više.
      //
      // `catch` je tu jer i sam poziv ume da padne — mreža u salonu koji je u
      // suterenu. Bez njega React odnese pad na granicu greške, pa vlasnica
      // izgubi ceo kalendar zbog jednog dodira po statusu.
      try {
        const result = await action();
        setError(result.ok ? null : result.message);
      } catch {
        setError(sr.error.unreachable);
      }
      setArmed(false);
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
            {/* Vidljivo 36px kao i dugmad oko njega, a dodirna zona razvučena
                na 44px istim potezom kao u `buttonVariants` — bez toga je ovo
                jedina meta u kalendaru koju prst promašuje. */}
            <a
              href={`tel:${appointment.client_phone}`}
              className="border-border hover:bg-accent relative inline-flex h-9 items-center rounded-md border px-3 text-sm after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']"
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

          <History appointmentId={appointment.id} timeZone={timeZone} />
        </div>
      ) : null}
    </li>
  );
}

/** Sivi red u danu: vreme koje je vlasnica sama uzela. */
function TimeOffRow({
  entry,
  timeZone,
}: {
  entry: DayTimeOff;
  timeZone: string;
}) {
  const label = [sr.dashboard.timeOff, entry.reason].filter(Boolean).join(" · ");

  // Isti ritam kao red termina: `py-1` na redu, `py-2` unutra.
  return (
    <li className="py-1 opacity-60">
      <div className="flex items-start gap-3 py-2">
        <span className="w-12 shrink-0 text-sm tabular-nums">
          {entry.wholeDay ? null : (
            <>
              <span className="block font-medium">
                {formatInTimeZone(new Date(entry.startAt), timeZone, "HH:mm")}
              </span>
              <span className="block text-xs">
                {formatInTimeZone(new Date(entry.endAt), timeZone, "HH:mm")}
              </span>
            </>
          )}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          {entry.wholeDay ? `${label} · ${sr.dashboard.timeOffWholeDay}` : label}
        </span>
      </div>
    </li>
  );
}

export function DayList({
  appointments,
  cancelled,
  timeOff,
  timeZone,
}: {
  appointments: DashboardAppointment[];
  cancelled: DashboardAppointment[];
  timeOff: DayTimeOff[];
  timeZone: string;
}) {
  const [showCancelled, setShowCancelled] = useState(false);

  // Odsustvo stoji u danu po vremenu, između termina, jer se tako i čita:
  // šta te čeka od ujutru do uveče.
  const rows = [
    ...appointments.map((appointment) => ({
      at: new Date(appointment.start_at).getTime(),
      node: (
        <Row
          key={appointment.id}
          appointment={appointment}
          timeZone={timeZone}
        />
      ),
    })),
    ...timeOff.map((entry) => ({
      at: new Date(entry.startAt).getTime(),
      node: <TimeOffRow key={entry.id} entry={entry} timeZone={timeZone} />,
    })),
  ].sort((left, right) => left.at - right.at);

  return (
    <>
      <ul className="divide-border divide-y">{rows.map((row) => row.node)}</ul>

      {/* Otkazan termin je oslobodio svoje vreme, pa ne stoji u spisku dana —
          ali mora da postoji negde: bez ovoga u interfejsu ne ostaje nikakav
          trag da je termin ikada postojao, ni put do njegove istorije. */}
      {cancelled.length > 0 ? (
        <div className="border-border border-t pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showCancelled}
            onClick={() => setShowCancelled((was) => !was)}
          >
            {sr.cancelled.toggle} · {cancelled.length}
          </Button>

          {showCancelled ? (
            <ul className="divide-border divide-y opacity-70">
              {cancelled.map((appointment) => (
                <Row
                  key={appointment.id}
                  appointment={appointment}
                  timeZone={timeZone}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
