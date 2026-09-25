"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Service } from "@/lib/db/services";
import { sr } from "@/lib/i18n/sr";
import { isRedirect } from "@/lib/utils";
import { saveAppointment, type NewAppointmentState } from "./actions";

/** Trajanja koja solo majstor stvarno koristi; ostalo je kucanje bez potrebe. */
const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240];

export function AppointmentForm({
  services,
  date,
  defaultDuration,
}: {
  services: Service[];
  date: string;
  defaultDuration: number;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<NewAppointmentState>({ status: "idle" });

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        setState(await saveAppointment(formData));
      } catch (cause) {
        // Uspeh se iz ove akcije vraća kao `redirect()`, a on do pregledača
        // ume da stigne kao greška. Takva mora da ide dalje do rutera —
        // progutana bi značila da se posle svakog uspešnog upisa ispiše da
        // ništa nije sačuvano.
        if (isRedirect(cause)) {
          throw cause;
        }
        setState({ status: "error", message: sr.error.unreachable });
      }
    });
  }

  return (
    // `onSubmit`, ne `action`: forma sa funkcijom kao akcijom posle svakog
    // slanja sama isprazni polja. Kad se vrati greška ili upozorenje, vlasnica
    // bi sve morala da kuca ponovo — a „Sačuvaj svejedno" ne bi imalo šta da
    // pošalje.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
      // Upozorenje važi za ono što je bilo upisano; posle izmene mora ponovo.
      onChange={() =>
        setState((current) =>
          current.status === "warning" ? { status: "idle" } : current,
        )
      }
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label htmlFor="date" className="text-sm font-medium">
            {sr.newAppointment.dateLabel}
          </label>
          <Input id="date" name="date" type="date" required defaultValue={date} />
        </div>

        <div className="space-y-2">
          <label htmlFor="time" className="text-sm font-medium">
            {sr.newAppointment.timeLabel}
          </label>
          <Input id="time" name="time" type="time" required step={300} />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="durationMin" className="text-sm font-medium">
          {sr.newAppointment.durationLabel}
        </label>
        <select
          id="durationMin"
          name="durationMin"
          required
          defaultValue={defaultDuration}
          className="border-input bg-background h-11 w-full rounded-md border px-3 text-sm"
        >
          {DURATIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} min
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label htmlFor="serviceId" className="text-sm font-medium">
          {sr.newAppointment.serviceLabel}
        </label>
        <select
          id="serviceId"
          name="serviceId"
          required
          className="border-input bg-background h-11 w-full rounded-md border px-3 text-sm"
        >
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name} · {service.duration_min} min
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          {sr.newAppointment.nameLabel}
        </label>
        <Input
          id="name"
          name="name"
          required
          autoComplete="name"
          maxLength={80}
          placeholder={sr.newAppointment.namePlaceholder}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="phone" className="text-sm font-medium">
          {sr.newAppointment.phoneLabel}
        </label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder={sr.newAppointment.phonePlaceholder}
        />
      </div>

      <p className="text-muted-foreground text-xs">{sr.newAppointment.hint}</p>

      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}

      {state.status === "warning" ? (
        <div role="status" className="space-y-2 border-l-2 border-l-[#8C1D3F] pl-3">
          <p className="text-sm">{state.message}</p>
          {/* Skriveno polje, ne ime na dugmetu: React forma sa funkcijom kao
              akcijom ne šalje uvek koje je dugme pritisnuto. */}
          <input type="hidden" name="ignoreWindow" value="1" />
          <Button
            type="submit"
            variant="outline"
            className="h-11 w-full"
            disabled={pending}
          >
            {sr.newAppointment.saveAnyway}
          </Button>
        </div>
      ) : null}

      <Button type="submit" className="h-12 w-full" disabled={pending}>
        {pending ? sr.newAppointment.submitting : sr.newAppointment.submit}
      </Button>
    </form>
  );
}
