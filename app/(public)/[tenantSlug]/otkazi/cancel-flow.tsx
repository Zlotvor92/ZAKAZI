"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UpcomingAppointment } from "@/lib/db/public-cancel";
import { sr } from "@/lib/i18n/sr";
import { cancelAppointment, lookupAppointments, type LookupState } from "./actions";

function formatPrice(rsd: number): string {
  return `${new Intl.NumberFormat("sr-RS").format(rsd)} ${sr.booking.currency}`;
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
  onCancelled: (id: string) => void;
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

      const result = await cancelAppointment(formData);

      if (result.status === "error") {
        setError(result.message);
        setArmed(false);
        return;
      }

      onCancelled(appointment.id);
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
            {formatInTimeZone(new Date(appointment.start_at), timeZone, "dd.MM.yyyy.")}{" "}
            {formatInTimeZone(new Date(appointment.start_at), timeZone, "HH:mm")}
          </div>
        </div>
        <div className="text-brand shrink-0 text-sm font-semibold tabular-nums">
          {formatPrice(appointment.price_rsd)}
        </div>
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

export function CancelFlow({ slug, timeZone }: { slug: string; timeZone: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<LookupState>({ status: "idle" });
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());

  function onLookup(formData: FormData) {
    startTransition(async () => {
      setState(await lookupAppointments(formData));
    });
  }

  if (state.status === "found") {
    const remaining = state.appointments.filter(
      (appointment) => !cancelledIds.has(appointment.id),
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

        {remaining.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {cancelledIds.size > 0 ? sr.cancel.cancelledTitle : sr.cancel.empty}
          </p>
        ) : (
          <ul className="space-y-2">
            {remaining.map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                slug={slug}
                phone={state.phone}
                timeZone={timeZone}
                onCancelled={(id) =>
                  setCancelledIds((current) => new Set(current).add(id))
                }
              />
            ))}
          </ul>
        )}

        {cancelledIds.size > 0 ? (
          <p className="text-muted-foreground text-center text-xs">
            {sr.cancel.cancelledBody}
          </p>
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
