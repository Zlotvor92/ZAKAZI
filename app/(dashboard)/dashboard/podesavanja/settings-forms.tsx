"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BlockedNumber } from "@/lib/db/blocklist";
import { minutesToTime } from "@/lib/domain/calendar";
import {
  defaultWeek,
  type DayShape,
} from "@/lib/domain/working-hours";
import { sr } from "@/lib/i18n/sr";
import {
  addBlockedNumber,
  removeBlockedNumber,
  saveBookingRules,
  saveWorkingHours,
  type SettingsState,
} from "./actions";

function Feedback({ state }: { state: SettingsState }) {
  if (state.status === "saved") {
    return <p className="text-muted-foreground text-sm">{sr.settings.saved}</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="text-destructive text-sm">
        {state.message}
      </p>
    );
  }
  return null;
}

/** Zajednički oblik: pošalji formu, upamti ishod, osveži stranicu. */
function useSettingsAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SettingsState>({ status: "idle" });

  function submit(action: (formData: FormData) => Promise<SettingsState>) {
    return (formData: FormData) => {
      startTransition(async () => {
        setState(await action(formData));
        router.refresh();
      });
    };
  }

  return { pending, state, submit, setState, router, startTransition };
}

export function WorkingHoursForm({ week }: { week: DayShape[] }) {
  const { pending, state, submit } = useSettingsAction();
  const [days, setDays] = useState(week);

  function update(weekday: number, patch: Partial<DayShape>) {
    setDays((current) =>
      current.map((day) =>
        day.weekday === weekday ? { ...day, ...patch } : day,
      ),
    );
  }

  return (
    <form action={submit(saveWorkingHours)} className="space-y-3">
      <p className="text-muted-foreground text-xs">{sr.settings.hoursHint}</p>

      {days.map((day) => (
        <div key={day.weekday} className="border-border rounded-lg border p-3">
          <label className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              name={`working-${day.weekday}`}
              checked={day.working}
              onChange={(event) =>
                update(day.weekday, { working: event.target.checked })
              }
              className="size-4"
            />
            <span className="text-sm font-medium">
              {sr.calendar.weekdaysShort[day.weekday - 1]}
            </span>
            <span className="text-muted-foreground text-xs">
              {day.working ? sr.settings.working : sr.settings.notWorking}
            </span>
          </label>

          {day.working ? (
            <div className="grid grid-cols-2 gap-2">
              <TimeField
                label={sr.settings.from}
                name={`start-${day.weekday}`}
                value={day.startMinute}
                onChange={(value) =>
                  value !== null && update(day.weekday, { startMinute: value })
                }
              />
              <TimeField
                label={sr.settings.to}
                name={`end-${day.weekday}`}
                value={day.endMinute}
                onChange={(value) =>
                  value !== null && update(day.weekday, { endMinute: value })
                }
              />
              <TimeField
                label={sr.settings.breakFrom}
                name={`break-start-${day.weekday}`}
                value={day.breakStartMinute}
                optional
                onChange={(value) =>
                  update(day.weekday, { breakStartMinute: value })
                }
              />
              <TimeField
                label={sr.settings.breakTo}
                name={`break-end-${day.weekday}`}
                value={day.breakEndMinute}
                optional
                onChange={(value) =>
                  update(day.weekday, { breakEndMinute: value })
                }
              />
            </div>
          ) : null}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setDays(defaultWeek())}
        >
          {sr.settings.useTemplate}
        </Button>
        <Button type="submit" disabled={pending}>
          {sr.settings.saveHours}
        </Button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

function TimeField({
  label,
  name,
  value,
  optional,
  onChange,
}: {
  label: string;
  name: string;
  value: number | null;
  optional?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-muted-foreground block text-xs">{label}</span>
      <Input
        type="time"
        name={name}
        required={!optional}
        step={900}
        value={value === null ? "" : minutesToTime(value)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const [hours, rest] = raw.split(":");
          onChange(Number(hours) * 60 + Number(rest));
        }}
      />
    </label>
  );
}

export function BookingRulesForm({
  horizonDays,
  leadHours,
  publicEnabled,
}: {
  horizonDays: number;
  leadHours: number;
  publicEnabled: boolean;
}) {
  const { pending, state, submit } = useSettingsAction();

  return (
    <form action={submit(saveBookingRules)} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-sm font-medium">{sr.settings.horizonLabel}</span>
        <Input
          type="number"
          name="horizonDays"
          min={1}
          max={90}
          required
          defaultValue={horizonDays}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{sr.settings.leadLabel}</span>
        <Input
          type="number"
          name="leadHours"
          min={0}
          max={168}
          required
          defaultValue={leadHours}
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="publicEnabled"
          defaultChecked={publicEnabled}
          className="size-4"
        />
        <span className="text-sm">{sr.settings.publicLabel}</span>
      </label>

      <Button type="submit" disabled={pending}>
        {sr.settings.saveRules}
      </Button>

      <Feedback state={state} />
    </form>
  );
}

export function BlockedNumbers({ numbers }: { numbers: BlockedNumber[] }) {
  const { pending, state, submit, setState, router, startTransition } =
    useSettingsAction();

  function unblock(id: string) {
    startTransition(async () => {
      setState(await removeBlockedNumber(id));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">{sr.settings.blockedHint}</p>

      {numbers.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {sr.settings.blockedEmpty}
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {numbers.map((number) => (
            <li
              key={number.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm tabular-nums">{number.phone_e164}</div>
                {number.reason ? (
                  <div className="text-muted-foreground truncate text-xs">
                    {number.reason}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => unblock(number.id)}
              >
                {sr.settings.unblock}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form action={submit(addBlockedNumber)} className="flex flex-wrap gap-2">
        <Input
          name="phone"
          type="tel"
          inputMode="tel"
          required
          placeholder={sr.booking.phonePlaceholder}
          className="min-w-40 flex-1"
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {sr.settings.addBlocked}
        </Button>
      </form>

      <Feedback state={state} />
    </div>
  );
}
