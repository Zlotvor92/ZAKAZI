"use client";

import { formatInTimeZone } from "date-fns-tz";
import { Phone } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  blockClient,
  changeStatus,
  loadClientCard,
  loadHistory,
  saveClientNote,
  type ActionState,
} from "@/app/(dashboard)/dashboard/actions";
import type {
  AppointmentHistoryEntry,
  AppointmentStatus,
  DashboardAppointment,
} from "@/lib/db/appointments";
import type { ClientCard } from "@/lib/db/clients";
import type { DayTimeOff } from "@/lib/domain/time-off";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";

/** Statusi koji su završena priča i zato izbledeli u spisku. */
const SETTLED = new Set<AppointmentStatus>(["completed", "no_show"]);

/** Boja statusa; ista skala kao na početnoj strani. */
const STATUS_COLOR: Record<AppointmentStatus, string> = {
  confirmed: "text-[#8C1D3F]",
  completed: "text-[#1C7A4E]",
  no_show: "text-[#B3261E]",
  cancelled_by_client: "text-[#6B6055]",
  cancelled_by_salon: "text-[#6B6055]",
};

type Action = { label: string; status: AppointmentStatus };

/**
 * Šta se nudi zavisi od toga gde je termin, ali iz svakog stanja postoji put
 * nazad: pogrešan dodir na telefonu je svakodnevica, a pogrešno upisan
 * izostanak ili otkazan termin kasnije nekoga košta. Odluka je vlasničina.
 */
function actionsFor(status: AppointmentStatus): Action[] {
  const restore: Action = {
    label: sr.dashboard.restore,
    status: "confirmed",
  };

  switch (status) {
    case "confirmed":
      return [
        { label: sr.dashboard.arrived, status: "completed" },
        { label: sr.dashboard.noShow, status: "no_show" },
        { label: sr.dashboard.cancel, status: "cancelled_by_salon" },
      ];
    case "completed":
      return [{ label: sr.dashboard.noShow, status: "no_show" }, restore];
    case "no_show":
      return [{ label: sr.dashboard.arrived, status: "completed" }, restore];
    default:
      return [restore];
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
    <li className="flex flex-wrap gap-x-1 text-xs text-[#6B6055]">
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

  // Dugme je stavka u redu sa ostalim dugmadima, a spisak ispod njega zauzima
  // celu širinu — u redu koji se prelama to ga samo po sebi stavlja u nov red.
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={shown}
        className="rounded-full border-[#E4DAC9] px-3.5 text-[#6B6055]"
        onClick={toggle}
      >
        {shown ? sr.history.hide : sr.history.show}
      </Button>

      {shown ? (
        <div className="w-full basis-full pt-1">
          {loading ? (
            <p className="text-xs text-[#6B6055]">{sr.history.loading}</p>
          ) : failed ? (
            <p role="alert" className="text-xs text-[#B3261E]">
              {failed}
            </p>
          ) : entries && entries.length > 0 ? (
            <ul className="space-y-0.5">
              {entries.map((entry) => (
                <HistoryLine key={entry.id} entry={entry} timeZone={timeZone} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[#6B6055]">{sr.history.empty}</p>
          )}
        </div>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[#FBF7F0] px-3 py-2">
      <div className="text-[17px] leading-tight font-bold tabular-nums">
        {value}
      </div>
      <div className="text-[11px] text-[#6B6055]">{label}</div>
    </div>
  );
}

/**
 * `onSaved` vraća sačuvan tekst kartici iznad: ona ostaje upamćena i kad se
 * zatvori, pa bi ponovo otvorena prikazala staru belešku — a sledeće
 * „Sačuvaj" bi njome pregazilo novu.
 */
function ClientNotes({
  card,
  onSaved,
}: {
  card: ClientCard;
  onSaved: (notes: string) => void;
}) {
  const [saving, startSaving] = useTransition();
  const [notes, setNotes] = useState(card.notes ?? "");
  const [result, setResult] = useState<ActionState | null>(null);

  function save() {
    startSaving(async () => {
      try {
        const saved = await saveClientNote(card.client_id, notes);
        setResult(saved);
        if (saved.ok) {
          onSaved(notes);
        }
      } catch {
        setResult({ ok: false, message: sr.error.unreachable });
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-[#554C44]">
          {sr.clientCard.notesLabel}
        </span>
        <textarea
          value={notes}
          maxLength={500}
          rows={3}
          placeholder={sr.clientCard.notesPlaceholder}
          onChange={(event) => {
            setNotes(event.target.value);
            setResult(null);
          }}
          className="w-full rounded-xl border border-[#E4DAC9] bg-white px-3 py-2 text-base outline-none focus:border-[#8C1D3F]"
        />
      </label>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          className="rounded-full border-[#DED5C7] bg-[#FBF7F0] px-3.5"
          onClick={save}
        >
          {sr.clientCard.saveNotes}
        </Button>
        {result === null ? null : result.ok ? (
          <span className="text-xs text-[#554C44]">
            {sr.clientCard.notesSaved}
          </span>
        ) : (
          <span role="alert" className="text-xs text-[#B3261E]">
            {result.message}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Sve o klijentkinji na jednom mestu: koliko puta je došla, koliko nije, i
 * beleška. Vezana je za broj telefona, pa zbir obuhvata sve termine sa tog
 * broja, i one zakazane pod drugim imenom.
 */
function ClientPanel({
  appointmentId,
  timeZone,
}: {
  appointmentId: string;
  timeZone: string;
}) {
  const [loading, startLoading] = useTransition();
  const [card, setCard] = useState<ClientCard | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  function toggle() {
    if (shown) {
      setShown(false);
      return;
    }

    setShown(true);

    if (card !== null) {
      return;
    }

    startLoading(async () => {
      try {
        const result = await loadClientCard(appointmentId);
        if (result.ok) {
          setCard(result.card);
          setFailed(null);
        } else {
          setFailed(result.message);
        }
      } catch {
        setFailed(sr.error.unreachable);
      }
    });
  }

  const date = (value: string) =>
    formatInTimeZone(new Date(value), timeZone, "dd.MM.yyyy.");

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={shown}
        className="rounded-full border-[#E4DAC9] px-3.5 text-[#6B6055]"
        onClick={toggle}
      >
        {shown ? sr.clientCard.hide : sr.clientCard.show}
      </Button>

      {shown ? (
        <div className="w-full basis-full space-y-2.5 pt-1">
          {loading ? (
            <p className="text-xs text-[#6B6055]">{sr.clientCard.loading}</p>
          ) : failed ? (
            <p role="alert" className="text-xs text-[#B3261E]">
              {failed}
            </p>
          ) : card ? (
            <>
              <div>
                <p className="text-[14.5px] font-semibold">{card.name}</p>
                <p className="text-xs text-[#554C44] tabular-nums">
                  {card.phone_e164}
                </p>
                {card.blocked ? (
                  <p className="pt-0.5 text-[9.5px] font-bold tracking-[0.12em] text-[#B3261E] uppercase">
                    {sr.clientCard.blocked}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <Stat label={sr.clientCard.completed} value={card.completed} />
                <Stat label={sr.clientCard.noShow} value={card.no_show} />
                <Stat
                  label={sr.clientCard.cancelledByClient}
                  value={card.cancelled_by_client}
                />
                <Stat
                  label={sr.clientCard.cancelledBySalon}
                  value={card.cancelled_by_salon}
                />
                <Stat label={sr.clientCard.upcoming} value={card.upcoming} />
              </div>

              <p className="text-xs text-[#6B6055]">
                {card.last_visit
                  ? `${sr.clientCard.lastVisit}: ${date(card.last_visit)}`
                  : sr.clientCard.neverVisited}
                {" · "}
                {`${sr.clientCard.since} ${date(card.first_seen)}`}
              </p>

              <ClientNotes
                card={card}
                onSaved={(notes) =>
                  setCard({ ...card, notes: notes.trim() === "" ? null : notes.trim() })
                }
              />
            </>
          ) : null}
        </div>
      ) : null}
    </>
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
    <li
      className={cn(
        "rounded-[18px] border border-[#E4DAC9] bg-white",
        SETTLED.has(appointment.status) && "opacity-70",
      )}
    >
      {/* Red drži dva odvojena poteza: dodir na termin ga otvara, dodir na
          krug pored njega zove. Veza u dugmetu ne bi radila — dugme bi joj
          pojelo dodir. */}
      <div className="flex items-center gap-2 p-3 pl-4">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3.5 py-1 text-left"
        >
          <span className="w-12 shrink-0 text-center">
            <span className="block text-[15px] leading-tight font-bold tabular-nums">
              {formatInTimeZone(new Date(appointment.start_at), timeZone, "HH:mm")}
            </span>
            <span className="block text-[10.5px] leading-tight text-[#6B6055] tabular-nums">
              {formatInTimeZone(new Date(appointment.end_at), timeZone, "HH:mm")}
            </span>
          </span>

          <span aria-hidden className="h-9 w-px shrink-0 bg-[#E4DAC9]" />

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-semibold">
              {appointment.client_name}
            </span>
            <span className="block truncate text-xs text-[#554C44]">
              {appointment.service_name}
              {appointment.source === "public"
                ? ` · ${sr.dashboard.fromPublicPage}`
                : ""}
            </span>
            {appointment.client_no_shows > 0 ? (
              <span className="block pt-0.5 text-[9.5px] font-bold tracking-[0.12em] text-[#B3261E] uppercase">
                {sr.dashboard.priorNoShows.replace(
                  "{puta}",
                  String(appointment.client_no_shows),
                )}
              </span>
            ) : null}
            {/* Potvrđen je podrazumevano stanje svakog budućeg termina, pa se
                ne ispisuje: red bi na svakom terminu dobio treću liniju koja
                ne kaže ništa. Ispisuje se ono što se razlikuje. */}
            {appointment.status === "confirmed" ? null : (
              <span
                className={cn(
                  "block pt-0.5 text-[9.5px] font-bold tracking-[0.12em] uppercase",
                  STATUS_COLOR[appointment.status],
                )}
              >
                {sr.appointmentStatus[appointment.status]}
              </span>
            )}
          </span>
        </button>

        <a
          href={`tel:${appointment.client_phone}`}
          aria-label={`${sr.dashboard.call} ${appointment.client_name}`}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FBF7F0] text-[#8C1D3F] transition-colors hover:bg-[#E4DAC9]"
        >
          <Phone size={17} strokeWidth={1.8} aria-hidden />
        </a>
      </div>

      {open ? (
        <div className="space-y-1.5 border-t border-[#E4DAC9] px-3 pt-2.5 pb-2.5">
          <div className="flex flex-wrap gap-1.5">
            {actions.map((action) => (
              <Button
                key={action.status}
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                className="rounded-full border-[#DED5C7] bg-[#FBF7F0] px-3.5"
                onClick={() => run(() => changeStatus(appointment.id, action.status))}
              >
                {action.label}
              </Button>
            ))}

            {/* Dva dodira namerno: blokada je teška odluka, promašen prst nije. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              className={cn(
                "rounded-full px-3.5",
                armed
                  ? "border-[#B3261E] bg-[#B3261E] text-[#FBF7F0] hover:bg-[#B3261E]/90 hover:text-[#FBF7F0]"
                  : "border-[#E4DAC9] text-[#B3261E] hover:text-[#B3261E]",
              )}
              onClick={() =>
                armed ? run(() => blockClient(appointment.id)) : setArmed(true)
              }
            >
              {armed ? sr.dashboard.blockConfirm : sr.dashboard.block}
            </Button>

            <History appointmentId={appointment.id} timeZone={timeZone} />
            <ClientPanel appointmentId={appointment.id} timeZone={timeZone} />
          </div>

          {error ? (
            <p role="alert" className="text-xs text-[#B3261E]">
              {error}
            </p>
          ) : null}
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

  return (
    <li className="flex items-center gap-3.5 rounded-[18px] bg-[#E4DAC9] px-4 py-3.5">
      <span className="w-12 shrink-0 text-center text-[13px] font-semibold text-[#554C44] tabular-nums">
        {entry.wholeDay
          ? "—"
          : formatInTimeZone(new Date(entry.startAt), timeZone, "HH:mm")}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] text-[#4A423B]">
        {entry.wholeDay
          ? `${label} · ${sr.dashboard.timeOffWholeDay}`
          : `${label} · ${sr.dashboard.timeOffUntil} ${formatInTimeZone(new Date(entry.endAt), timeZone, "HH:mm")}`}
      </span>
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
      <ul className="space-y-2.5">{rows.map((row) => row.node)}</ul>

      {/* Otkazan termin je oslobodio svoje vreme, pa ne stoji u spisku dana —
          ali mora da postoji negde: bez ovoga u interfejsu ne ostaje nikakav
          trag da je termin ikada postojao, ni put do njegove istorije. */}
      {cancelled.length > 0 ? (
        <div className="pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showCancelled}
            className="rounded-full px-3 text-[#6B6055]"
            onClick={() => setShowCancelled((was) => !was)}
          >
            {sr.cancelled.toggle} · {cancelled.length}
          </Button>

          {showCancelled ? (
            <ul className="space-y-2.5 pt-2 opacity-70">
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
