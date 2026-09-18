"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UpcomingAppointment } from "@/lib/db/public-cancel";
import { sr } from "@/lib/i18n/sr";
import { cancelAppointment, lookupAppointments, type LookupState } from "./actions";

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

  return (
    <li className="border-border space-y-2 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {appointment.service_name}
          </div>
          <div className="text-muted-foreground text-xs tabular-nums">
            {formatWhen(appointment.start_at, timeZone)}
          </div>
        </div>
        {formatPrice(appointment.price_rsd) ? (
          <div className="text-brand shrink-0 text-sm font-semibold tabular-nums">
            {formatPrice(appointment.price_rsd)}
          </div>
        ) : null}
      </div>

      <Button
        type="button"
        variant={armed ? "default" : "outline"}
        size="sm"
        disabled={pending}
        onClick={() => (armed ? confirmCancel() : setArmed(true))}
      >
        {pending
          ? sr.cancel.cancelling
          : armed
            ? sr.cancel.cancelConfirm
            : sr.cancel.cancelButton}
      </Button>

      {error ? (
        <p role="alert" className="text-destructive text-xs">
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
    <li className="border-border space-y-2 rounded-xl border border-dashed p-3">
      <div className="text-muted-foreground min-w-0 text-sm">
        <span className="line-through">{appointment.service_name}</span>{" "}
        <span className="tabular-nums">
          {formatWhen(appointment.start_at, timeZone)}
        </span>
      </div>

      <a
        href={href}
        className="border-border text-brand inline-flex h-11 w-full items-center justify-center rounded-xl border text-sm font-medium"
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
      <div className="space-y-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">{state.phone}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setState({ status: "idle" })}
          >
            {sr.cancel.changePhone}
          </Button>
        </div>

        {remaining.length === 0 && cancelled.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {sr.cancel.empty}
          </p>
        ) : null}

        {remaining.length > 0 ? (
          <ul className="space-y-2">
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
          <div className="space-y-2">
            <p className="text-sm font-medium">{sr.cancel.cancelledTitle}</p>
            <p className="text-muted-foreground text-xs">
              {sr.cancel.removeFromCalendarHint}
            </p>

            <ul className="space-y-2">
              {cancelled.map((appointment) => (
                <CancelledRow
                  key={appointment.id}
                  appointment={appointment}
                  salonName={salonName}
                  timeZone={timeZone}
                />
              ))}
            </ul>

            <p className="text-muted-foreground text-center text-xs">
              {sr.cancel.cancelledBody}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form action={onLookup} className="space-y-4 py-4">
      <input type="hidden" name="slug" value={slug} />

      <p className="text-muted-foreground text-sm">{sr.cancel.intro}</p>

      <div className="space-y-2">
        <label htmlFor="cancel-phone" className="text-sm font-medium">
          {sr.booking.phoneLabel}
        </label>
        <Input
          id="cancel-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder={sr.booking.phonePlaceholder}
        />
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" className="h-12 w-full" disabled={pending}>
        {pending ? sr.cancel.submitting : sr.cancel.submit}
      </Button>
    </form>
  );
}
