"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeSelect } from "@/components/ui/time-select";
import type { BlockedNumber } from "@/lib/db/blocklist";
import type { Service } from "@/lib/db/services";
import type { TimeOff } from "@/lib/db/time-off";
import {
  defaultWeek,
  slotCounts,
  withSlotCount,
  type DayShape,
} from "@/lib/domain/working-hours";
import { sr } from "@/lib/i18n/sr";
import {
  addBlockedNumber,
  deleteServiceEntry,
  deleteTimeOff,
  removeBlockedNumber,
  saveBookingRules,
  saveServiceEntry,
  saveTimeOff,
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

/**
 * Zajednički oblik: pošalji formu, upamti ishod. Svež sadržaj stiže uz odgovor
 * akcije, jer svaka od njih zove `revalidatePath` — dodatno osvežavanje bi bio
 * pun zahtev više za podatke koji su već stigli.
 */
function useSettingsAction() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SettingsState>({ status: "idle" });

  function submit(action: (formData: FormData) => Promise<SettingsState>) {
    return (formData: FormData) => {
      startTransition(async () => {
        setState(await action(formData));
      });
    };
  }

  function call(action: () => Promise<SettingsState>) {
    startTransition(async () => {
      setState(await action());
    });
  }

  return { pending, state, submit, call };
}

type SlotMode = "count" | "minutes";

function slotSummary(day: DayShape): string {
  const counts = slotCounts(day);

  if (counts.length === 0) {
    return "";
  }

  const word = (count: number) =>
    count === 1 ? sr.settings.slotSummaryOne : sr.settings.slotSummaryFew;

  if (counts.length === 1) {
    return `${counts[0]} ${word(counts[0]!)} · po ${day.slotMinutes} min`;
  }

  return (
    `${counts[0]} ${word(counts[0]!)} ${sr.settings.beforeBreak}, ` +
    `${counts[1]} ${word(counts[1]!)} ${sr.settings.afterBreak} · ` +
    `po ${day.slotMinutes} min`
  );
}

export function WorkingHoursForm({ week }: { week: DayShape[] }) {
  const { pending, state, submit } = useSettingsAction();
  const [days, setDays] = useState(week);
  const [mode, setMode] = useState<SlotMode>("minutes");

  function update(weekday: number, patch: Partial<DayShape>) {
    setDays((current) =>
      current.map((day) =>
        day.weekday === weekday ? { ...day, ...patch } : day,
      ),
    );
  }

  function setCount(weekday: number, count: number) {
    setDays((current) =>
      current.map((day) =>
        day.weekday === weekday ? withSlotCount(day, count) : day,
      ),
    );
  }

  return (
    <form action={submit(saveWorkingHours)} className="space-y-3">
      <p className="text-muted-foreground text-xs">{sr.settings.hoursHint}</p>

      {/* Oba načina upisuju isti podatak; prekidač menja samo šta se kuca. */}
      <fieldset className="flex items-center gap-2">
        <legend className="text-muted-foreground pb-1 text-xs">
          {sr.settings.slotModeLabel}
        </legend>
        {(["minutes", "count"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={mode === option ? "default" : "outline"}
            onClick={() => setMode(option)}
          >
            {option === "minutes"
              ? sr.settings.slotModeMinutes
              : sr.settings.slotModeCount}
          </Button>
        ))}
      </fieldset>

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
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label={sr.settings.from}>
                  <TimeSelect
                    name={`start-${day.weekday}`}
                    value={day.startMinute}
                    onChange={(value) =>
                      value !== null &&
                      update(day.weekday, { startMinute: value })
                    }
                  />
                </Field>
                <Field label={sr.settings.to}>
                  <TimeSelect
                    name={`end-${day.weekday}`}
                    value={day.endMinute}
                    onChange={(value) =>
                      value !== null && update(day.weekday, { endMinute: value })
                    }
                  />
                </Field>
                <Field label={sr.settings.breakFrom}>
                  <TimeSelect
                    name={`break-start-${day.weekday}`}
                    value={day.breakStartMinute}
                    placeholder="—"
                    onChange={(value) =>
                      update(day.weekday, { breakStartMinute: value })
                    }
                  />
                </Field>
                <Field label={sr.settings.breakTo}>
                  <TimeSelect
                    name={`break-end-${day.weekday}`}
                    value={day.breakEndMinute}
                    placeholder="—"
                    onChange={(value) =>
                      update(day.weekday, { breakEndMinute: value })
                    }
                  />
                </Field>
              </div>

              <Field
                label={
                  mode === "count"
                    ? sr.settings.slotCountLabel
                    : sr.settings.slotMinutesLabel
                }
              >
                {mode === "count" ? (
                  <NumberField
                    name={`count-${day.weekday}`}
                    value={slotCounts(day)[0] ?? 1}
                    min={1}
                    max={20}
                    onCommit={(count) => setCount(day.weekday, count)}
                  />
                ) : (
                  <NumberField
                    name={`minutes-${day.weekday}`}
                    value={day.slotMinutes}
                    min={5}
                    max={600}
                    step={5}
                    onCommit={(minutes) =>
                      update(day.weekday, { slotMinutes: minutes })
                    }
                  />
                )}
              </Field>

              {/* Trajanje je ono što se čuva, i u oba načina putuje ovim poljem. */}
              <input
                type="hidden"
                name={`slot-${day.weekday}`}
                value={day.slotMinutes}
              />

              <p className="text-muted-foreground text-xs">
                {slotSummary(day)}
              </p>
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

/**
 * Broj koji sme da bude prazan dok se kuca. Bez ovoga brisanje jedine cifre
 * daje nulu, nula se odmah pretvori nazad u ispravnu vrednost, i polje ne
 * može da se isprazni da bi se ukucalo nešto drugo.
 */
function NumberField({
  name,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      name={name}
      type="text"
      inputMode="numeric"
      value={draft ?? String(value)}
      onChange={(event) => {
        const raw = event.target.value.replace(/[^0-9]/g, "");
        setDraft(raw);

        const parsed = Number(raw);
        if (raw !== "" && parsed >= min && parsed <= max) {
          onCommit(parsed);
        }
      }}
      // Prazno polje se pri izlasku vraća na poslednju ispravnu vrednost.
      onBlur={() => setDraft(null)}
      aria-valuemin={min}
      aria-valuemax={max}
      step={step}
    />
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground block text-xs">{label}</span>
      {children}
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
  const { pending, state, submit, call } = useSettingsAction();

  function unblock(id: string) {
    call(() => removeBlockedNumber(id));
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

export function TimeOffSection({
  entries,
  timeZone,
  today,
}: {
  entries: TimeOff[];
  timeZone: string;
  today: string;
}) {
  const { pending, state, submit, call } = useSettingsAction();

  function remove(id: string) {
    call(() => deleteTimeOff(id));
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">{sr.settings.timeOffHint}</p>

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {sr.settings.timeOffEmpty}
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm tabular-nums">
                  {describeTimeOff(entry, timeZone)}
                </div>
                {entry.reason ? (
                  <div className="text-muted-foreground truncate text-xs">
                    {entry.reason}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => remove(entry.id)}
              >
                {sr.settings.removeTimeOff}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form action={submit(saveTimeOff)} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-muted-foreground block text-xs">
              {sr.settings.timeOffFrom}
            </span>
            <Input type="date" name="fromDate" required defaultValue={today} />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground block text-xs">
              {sr.settings.timeOffTo}
            </span>
            <Input type="date" name="toDate" required defaultValue={today} />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground block text-xs">
              {sr.settings.timeOffFromTime}
            </span>
            <Input type="time" name="fromTime" step={900} />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground block text-xs">
              {sr.settings.timeOffToTime}
            </span>
            <Input type="time" name="toTime" step={900} />
          </label>
        </div>

        <Input
          name="reason"
          maxLength={80}
          placeholder={sr.settings.timeOffReasonPlaceholder}
        />

        <Button type="submit" variant="outline" disabled={pending}>
          {sr.settings.addTimeOff}
        </Button>
      </form>

      <Feedback state={state} />
    </div>
  );
}

/** Ceo dan se prepoznaje po tome što traje od ponoći do ponoći. */
function describeTimeOff(entry: TimeOff, timeZone: string): string {
  const from = new Date(entry.start_at);
  const to = new Date(entry.end_at);

  const fromDay = formatInTimeZone(from, timeZone, "dd.MM.");
  const wholeDays =
    formatInTimeZone(from, timeZone, "HH:mm") === "00:00" &&
    formatInTimeZone(to, timeZone, "HH:mm") === "00:00";

  if (wholeDays) {
    const lastDay = formatInTimeZone(
      new Date(to.getTime() - 1),
      timeZone,
      "dd.MM.",
    );
    return fromDay === lastDay
      ? `${fromDay} (${sr.settings.wholeDay})`
      : `${fromDay} – ${lastDay}`;
  }

  const toDay = formatInTimeZone(to, timeZone, "dd.MM.");
  const fromTime = formatInTimeZone(from, timeZone, "HH:mm");
  const toTime = formatInTimeZone(to, timeZone, "HH:mm");

  return fromDay === toDay
    ? `${fromDay} ${fromTime}–${toTime}`
    : `${fromDay} ${fromTime} – ${toDay} ${toTime}`;
}

export function ServicesSection({ services }: { services: Service[] }) {
  const { pending, state, submit, call } = useSettingsAction();

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">{sr.settings.servicesHint}</p>

      {services.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {sr.settings.servicesEmpty}
        </p>
      ) : null}

      {services.map((service) => (
        <form
          key={service.id}
          action={submit(saveServiceEntry)}
          className="border-border space-y-2 rounded-lg border p-3"
        >
          <input type="hidden" name="id" value={service.id} />

          <Input
            name="name"
            defaultValue={service.name}
            maxLength={60}
            required
            aria-label={sr.settings.serviceName}
          />

          <div className="grid grid-cols-2 gap-2">
            <Field label={sr.settings.serviceDuration}>
              <Input
                name="durationMin"
                type="text"
                inputMode="numeric"
                defaultValue={service.duration_min}
                required
              />
            </Field>
            <Field label={sr.settings.servicePrice}>
              <Input
                name="priceRsd"
                type="text"
                inputMode="numeric"
                defaultValue={service.price_rsd}
                required
              />
            </Field>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {sr.settings.saveService}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => call(() => deleteServiceEntry(service.id))}
            >
              {sr.settings.removeService}
            </Button>
          </div>
        </form>
      ))}

      <form
        action={submit(saveServiceEntry)}
        className="border-border space-y-2 rounded-lg border border-dashed p-3"
      >
        <input type="hidden" name="id" value="" />

        <Input
          name="name"
          placeholder={sr.settings.serviceNamePlaceholder}
          maxLength={60}
          required
          aria-label={sr.settings.serviceName}
        />

        <div className="grid grid-cols-2 gap-2">
          <Field label={sr.settings.serviceDuration}>
            <Input
              name="durationMin"
              type="text"
              inputMode="numeric"
              defaultValue={90}
              required
            />
          </Field>
          <Field label={sr.settings.servicePrice}>
            <Input
              name="priceRsd"
              type="text"
              inputMode="numeric"
              defaultValue={0}
              required
            />
          </Field>
        </div>

        <Button type="submit" size="sm" disabled={pending}>
          {sr.settings.addService}
        </Button>
      </form>

      <Feedback state={state} />
    </div>
  );
}
