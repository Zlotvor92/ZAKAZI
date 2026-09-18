"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useState, useTransition } from "react";
import { display } from "@/app/fonts";
import type { UpcomingAppointment } from "@/lib/db/public-cancel";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";
import { cancelAppointment, lookupAppointments, type LookupState } from "./actions";

const pressable =
  "transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100";

const enter =
  "animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none";

const microLabel =
  "text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase";

/** `null` za besplatnu uslugu — „0 RSD" izgleda kao greška, ne kao poklon. */
function formatPrice(rsd: number): string | null {
  if (rsd === 0) {
    return null;
  }
  return `${new Intl.NumberFormat("sr-RS").format(rsd)} ${sr.booking.currency}`;
}

function formatWhen(value: string, timeZone: string): string {
  return `${formatInTimeZone(new Date(value), timeZone, "dd.MM.yyyy.")} ${formatInTimeZone(new Date(value), timeZone, "HH:mm")}`;
}

function AppointmentRow({
  appointment,
  slug,
  phone,
  timeZone,
  onCancelled,
}: {
  appointment: UpcomingAppointment;
  slug: string;
  phone: string;
  timeZone: string;
  onCancelled: (appointment: UpcomingAppointment) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirmCancel() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("slug", slug);
      formData.set("phone", phone);
      formData.set("appointmentId", appointment.id);

      // Prekinuta veza ili pad servera ne smeju da odvedu na granicu greške:
      // otkazivanje je zadnji korak pre nego što salon ostane sa praznim
      // satom, i mora da kaže da nije prošlo.
      let result;
      try {
        result = await cancelAppointment(formData);
      } catch {
        setError(sr.error.unreachable);
        setArmed(false);
        return;
      }

      if (result.status === "error") {
        setError(result.message);
        setArmed(false);
        return;
      }

      onCancelled(appointment);
    });
  }

  const price = formatPrice(appointment.price_rsd);

  return (
    <li className="flex flex-col gap-2.5 border-b border-[#E4DAC9] py-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex min-w-0 flex-col gap-1">
          <span className={`${display.className} text-[19px] leading-tight`}>
            {appointment.service_name}
          </span>
          <span className={`${microLabel} tabular-nums`}>
            {formatWhen(appointment.start_at, timeZone)}
          </span>
        </span>
        {price ? (
          <span
            className={`${display.className} shrink-0 text-[17px] tabular-nums`}
          >
            {price}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => (armed ? confirmCancel() : setArmed(true))}
        className={cn(
          "flex h-11 items-center justify-center self-start px-5 text-[11px] font-bold tracking-[0.16em] uppercase disabled:opacity-60",
          armed
            ? "bg-[#8C1D3F] text-[#FBF7F0] active:bg-[#6E162F]"
            : "border border-[#211D1A] active:bg-[#F2EADC]",
          pressable,
        )}
      >
        {pending
          ? sr.cancel.cancelling
          : armed
            ? sr.cancel.cancelConfirm
            : sr.cancel.cancelButton}
      </button>

      {error ? (
        <p
          role="alert"
          className={cn(
            "border-l-2 border-[#8C1D3F] pl-3 text-xs text-[#8C1D3F]",
            enter,
          )}
        >
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Otkazan termin, sa načinom da se izbaci i iz kalendara telefona.
 *
 * Fajl koji je klijentkinja preuzela pri zakazivanju nije pretplata: telefon
 * nema od koga da sazna da termina više nema, pa unos ostaje da stoji i
 * podsetnici iz njega zvone. Ovo je jedini put da se to poništi.
 */
function CancelledRow({
  appointment,
  salonName,
  timeZone,
}: {
  appointment: UpcomingAppointment;
  salonName: string;
  timeZone: string;
}) {
  const href = `/api/kalendar?${new URLSearchParams({
    pocetak: appointment.start_at,
    kraj: appointment.end_at,
    usluga: appointment.service_name,
    salon: salonName,
    otkazano: "1",
  }).toString()}`;

  return (
    <li className="flex flex-col gap-2.5 border-b border-[#E4DAC9] py-4">
      <span className="flex min-w-0 flex-col gap-1 text-[#6B6055]">
        <span
          className={`${display.className} text-[19px] leading-tight line-through`}
        >
          {appointment.service_name}
        </span>
        <span className={`${microLabel} tabular-nums`}>
          {formatWhen(appointment.start_at, timeZone)}
        </span>
      </span>

      <a
        href={href}
        className={cn(
          "flex h-11 items-center justify-center self-start px-5 text-[11px] font-bold tracking-[0.16em] text-[#8C1D3F] uppercase",
          "border border-[#8C1D3F] active:bg-[#F2EADC]",
          pressable,
        )}
      >
        {sr.cancel.removeFromCalendar}
      </a>
    </li>
  );
}

export function CancelFlow({
  slug,
  salonName,
  timeZone,
}: {
  slug: string;
  salonName: string;
  timeZone: string;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<LookupState>({ status: "idle" });
  const [cancelled, setCancelled] = useState<UpcomingAppointment[]>([]);

  function onLookup(formData: FormData) {
    startTransition(async () => {
      try {
        setState(await lookupAppointments(formData));
      } catch {
        setState({ status: "error", message: sr.error.unreachable });
      }
    });
  }

  if (state.status === "found") {
    const remaining = state.appointments.filter(
      (appointment) => !cancelled.some((done) => done.id === appointment.id),
    );

    return (
      <div className={cn("flex flex-col gap-4", enter)}>
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#211D1A] pb-2.5">
          <p className={`${microLabel} tabular-nums`}>{state.phone}</p>
          <button
            type="button"
            onClick={() => setState({ status: "idle" })}
            className={cn(
              "shrink-0 px-2 py-3 text-[11px] font-bold tracking-[0.14em] text-[#8C1D3F] uppercase",
              pressable,
            )}
          >
            {sr.cancel.changePhone}
          </button>
        </div>

        {remaining.length === 0 && cancelled.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#554C44]">
            {sr.cancel.empty}
          </p>
        ) : null}

        {remaining.length > 0 ? (
          <ul className="flex flex-col">
            {remaining.map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                slug={slug}
                phone={state.phone}
                timeZone={timeZone}
                onCancelled={(done) =>
                  setCancelled((current) => [...current, done])
                }
              />
            ))}
          </ul>
        ) : null}

        {cancelled.length > 0 ? (
          <div className={cn("flex flex-col gap-2", enter)}>
            <h2 className={`${display.className} text-[22px] leading-tight`}>
              {sr.cancel.cancelledTitle}
            </h2>
            <p className="text-xs leading-relaxed text-[#6B6055]">
              {sr.cancel.removeFromCalendarHint}
            </p>

            <ul className="flex flex-col">
              {cancelled.map((appointment) => (
                <CancelledRow
                  key={appointment.id}
                  appointment={appointment}
                  salonName={salonName}
                  timeZone={timeZone}
                />
              ))}
            </ul>

            <p className="text-center text-xs text-[#6B6055]">
              {sr.cancel.cancelledBody}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form action={onLookup} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />

      <p className="text-sm leading-relaxed text-[#554C44]">
        {sr.cancel.intro}
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cancel-phone" className={microLabel}>
          {sr.booking.phoneLabel}
        </label>
        <input
          id="cancel-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder={sr.booking.phonePlaceholder}
          className="h-12 w-full border-b border-[#211D1A] bg-transparent text-base transition-colors outline-none placeholder:text-[#A2988C] focus:border-[#8C1D3F]"
        />
      </div>

      {state.status === "error" ? (
        <p
          role="alert"
          className={cn(
            "border-l-2 border-[#8C1D3F] pl-3 text-sm text-[#8C1D3F]",
            enter,
          )}
        >
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={cn(
          "flex h-14 w-full items-center justify-center bg-[#211D1A] text-xs font-bold tracking-[0.18em] text-[#FBF7F0] uppercase active:bg-[#3A332D] disabled:opacity-60",
          pressable,
        )}
      >
        {pending ? sr.cancel.submitting : sr.cancel.submit}
      </button>
    </form>
  );
}
