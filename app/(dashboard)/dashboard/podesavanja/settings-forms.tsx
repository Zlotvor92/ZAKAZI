"use client";

import { formatInTimeZone } from "date-fns-tz";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  disableCalendarFeed,
  enableCalendarFeed,
  addBlockedNumber,
  deleteServiceEntry,
  deleteTimeOff,
  moveServiceEntry,
  removeBlockedNumber,
  saveBookingRules,
  saveServiceEntry,
  saveTimeOff,
  saveWorkingHours,
  type SettingsState,
} from "./actions";

/**
 * Kopira zadati tekst i to kaže.
 *
 * Ostava ume da bude zabranjena — stroža podešavanja pregledača, ugrađeni
 * pregledač u Instagramu. Tada se ne sme ćutati: vlasnici koja je pritisla
 * dugme i ništa se nije desilo ostaje da nagađa, pa dobija uputstvo kako da
 * kopira rukom.
 */
function CopyButton({
  value,
  label,
  onFailed,
  className,
}: {
  value: string;
  label: string;
  onFailed: (failed: boolean) => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("rounded-full", className)}
      onClick={() => {
        // Ostave ume i da nema, ne samo da odbije: stariji ugrađeni pregledači
        // je nemaju uopšte. Bez ove provere poziv pukne pre nego što `catch`
        // stigne da javi, pa dugme ćuti.
        if (!navigator.clipboard) {
          onFailed(true);
          return;
        }

        void navigator.clipboard
          .writeText(value)
          .then(() => {
            onFailed(false);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => onFailed(true));
      }}
    >
      {copied ? sr.settings.copied : label}
    </Button>
  );
}

function Feedback({ state }: { state: SettingsState }) {
  if (state.status === "saved") {
    return <p className="text-sm text-[#554C44]">{sr.settings.saved}</p>;
  }
  // Upisano je, ali ima šta da se uradi rukom. Nije greška, pa nije crveno —
  // ali ni obično „Sačuvano.", jer se preko toga pređe bez čitanja.
  if (state.status === "warning") {
    return (
      <p role="status" className="border-l-2 border-l-[#8C1D3F] pl-3 text-sm">
        {state.message}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="text-[#B3261E] text-sm">
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

  /**
   * Pad samog poziva — prekinuta mreža ili greška na serveru — mora da ostane
   * u formi. Bez ovoga React odnese odbijeno obećanje na granicu greške i cela
   * podešavanja se zamene stranom „Nešto je puklo".
   */
  function guard(work: Promise<SettingsState>): Promise<SettingsState> {
    return work.catch(() => ({
      status: "error" as const,
      message: sr.error.unreachable,
    }));
  }

  function submit(action: (formData: FormData) => Promise<SettingsState>) {
    return (formData: FormData) => {
      startTransition(async () => {
        setState(await guard(action(formData)));
      });
    };
  }

  function call(action: () => Promise<SettingsState>) {
    startTransition(async () => {
      setState(await guard(action()));
    });
  }

  /**
   * Ishod prethodnog čuvanja prestaje da važi čim se polje promeni.
   *
   * Bez ovoga „Sačuvano." stoji i dalje dok se kuca nova vrednost, pa i kad
   * pregledač sam odbije slanje zbog neispravnog broja (`min`/`max` na polju)
   * — a tada ništa nije sačuvano iako poruka tvrdi da jeste.
   */
  function reset() {
    setState((current) =>
      current.status === "idle" ? current : { status: "idle" },
    );
  }

  return { pending, state, submit, call, reset };
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
  const { pending, state, submit, reset } = useSettingsAction();
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
    <form
      action={submit(saveWorkingHours)}
      onChange={reset}
      className="space-y-3"
    >
      <p className="text-[#554C44] text-xs">{sr.settings.hoursHint}</p>

      {/* Oba načina upisuju isti podatak; prekidač menja samo šta se kuca. */}
      <fieldset className="flex items-center gap-2">
        <legend className="text-[#554C44] pb-1 text-xs">
          {sr.settings.slotModeLabel}
        </legend>
        {(["minutes", "count"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={mode === option ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setMode(option)}
          >
            {option === "minutes"
              ? sr.settings.slotModeMinutes
              : sr.settings.slotModeCount}
          </Button>
        ))}
      </fieldset>

      {days.map((day) => (
        <div key={day.weekday} className="rounded-2xl border border-[#E4DAC9] bg-[#FBF7F0] p-3">
          {/* Kvačica je 20px, ali se dodiruje ceo red visok 44px. */}
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name={`working-${day.weekday}`}
              checked={day.working}
              onChange={(event) =>
                update(day.weekday, { working: event.target.checked })
              }
              className="size-5"
            />
            <span className="text-sm font-medium">
              {sr.calendar.weekdaysShort[day.weekday - 1]}
            </span>
            <span className="text-[#554C44] text-xs">
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

              <p className="text-[#554C44] text-xs">
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
          className="rounded-full"
          onClick={() => setDays(defaultWeek())}
        >
          {sr.settings.useTemplate}
        </Button>
        <Button type="submit" className="rounded-full" disabled={pending}>
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
      <span className="text-[#554C44] block text-xs">{label}</span>
      {children}
    </label>
  );
}

export function BookingRulesForm({
  horizonDays,
  leadHours,
  publicEnabled,
  breakOverrunMin,
  shiftOverrunMin,
}: {
  horizonDays: number;
  leadHours: number;
  publicEnabled: boolean;
  breakOverrunMin: number;
  shiftOverrunMin: number;
}) {
  const { pending, state, submit, reset } = useSettingsAction();

  return (
    <form
      action={submit(saveBookingRules)}
      onChange={reset}
      className="space-y-3"
    >
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

      <div className="space-y-1 pt-1">
        <p className="text-[#554C44] text-xs">{sr.settings.overrunHint}</p>

        <label className="block space-y-1">
          <span className="text-sm font-medium">
            {sr.settings.breakOverrunLabel}
          </span>
          <Input
            type="number"
            name="breakOverrunMin"
            min={0}
            max={120}
            required
            defaultValue={breakOverrunMin}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">
            {sr.settings.shiftOverrunLabel}
          </span>
          <Input
            type="number"
            name="shiftOverrunMin"
            min={0}
            max={120}
            required
            defaultValue={shiftOverrunMin}
          />
        </label>
      </div>

      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          name="publicEnabled"
          defaultChecked={publicEnabled}
          className="size-5"
        />
        <span className="text-sm">{sr.settings.publicLabel}</span>
      </label>

      <Button type="submit" className="rounded-full" disabled={pending}>
        {sr.settings.saveRules}
      </Button>

      <Feedback state={state} />
    </form>
  );
}

export function BlockedNumbers({ numbers }: { numbers: BlockedNumber[] }) {
  const { pending, state, submit, call, reset } = useSettingsAction();

  function unblock(id: string) {
    call(() => removeBlockedNumber(id));
  }

  return (
    <div className="space-y-3" onChange={reset}>
      <p className="text-[#554C44] text-xs">{sr.settings.blockedHint}</p>

      {numbers.length === 0 ? (
        <p className="text-[#554C44] text-sm">
          {sr.settings.blockedEmpty}
        </p>
      ) : (
        <ul className="divide-y divide-[#E4DAC9]">
          {numbers.map((number) => (
            <li
              key={number.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm tabular-nums">{number.phone_e164}</div>
                {number.reason ? (
                  <div className="text-[#554C44] truncate text-xs">
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
        <Button
          type="submit"
          variant="outline"
          className="rounded-full"
          disabled={pending}
        >
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
  const { pending, state, submit, call, reset } = useSettingsAction();

  function remove(id: string) {
    call(() => deleteTimeOff(id));
  }

  return (
    <div className="space-y-3" onChange={reset}>
      <p className="text-[#554C44] text-xs">{sr.settings.timeOffHint}</p>

      {entries.length === 0 ? (
        <p className="text-[#554C44] text-sm">
          {sr.settings.timeOffEmpty}
        </p>
      ) : (
        <ul className="divide-y divide-[#E4DAC9]">
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
                  <div className="text-[#554C44] truncate text-xs">
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
            <span className="text-[#554C44] block text-xs">
              {sr.settings.timeOffFrom}
            </span>
            <Input type="date" name="fromDate" required defaultValue={today} />
          </label>
          <label className="space-y-1">
            <span className="text-[#554C44] block text-xs">
              {sr.settings.timeOffTo}
            </span>
            <Input type="date" name="toDate" required defaultValue={today} />
          </label>
          <label className="space-y-1">
            <span className="text-[#554C44] block text-xs">
              {sr.settings.timeOffFromTime}
            </span>
            <Input type="time" name="fromTime" step={900} />
          </label>
          <label className="space-y-1">
            <span className="text-[#554C44] block text-xs">
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

        <Button
          type="submit"
          variant="outline"
          className="rounded-full"
          disabled={pending}
        >
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
  const { pending, state, submit, call, reset } = useSettingsAction();

  return (
    <div className="space-y-3" onChange={reset}>
      <p className="text-[#554C44] text-xs">{sr.settings.servicesHint}</p>

      {services.length === 0 ? (
        <p className="text-[#554C44] text-sm">
          {sr.settings.servicesEmpty}
        </p>
      ) : null}

      {services.map((service, index) => (
        <form
          key={service.id}
          action={submit(saveServiceEntry)}
          className="space-y-2 rounded-2xl border border-[#E4DAC9] bg-[#FBF7F0] p-3"
        >
          <input type="hidden" name="id" value={service.id} />

          <div className="flex items-center gap-1">
            <Input
              name="name"
              defaultValue={service.name}
              maxLength={60}
              required
              aria-label={sr.settings.serviceName}
              className="min-w-0"
            />
            {/* Kartice su vezane ključem za uslugu, pa neposlata izmena u
                poljima putuje sa karticom umesto da pređe na susednu. */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="shrink-0"
              aria-label={sr.settings.moveServiceUp}
              disabled={pending || index === 0}
              onClick={() => call(() => moveServiceEntry(service.id, "up"))}
            >
              <ChevronUp />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="shrink-0"
              aria-label={sr.settings.moveServiceDown}
              disabled={pending || index === services.length - 1}
              onClick={() => call(() => moveServiceEntry(service.id, "down"))}
            >
              <ChevronDown />
            </Button>
          </div>

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

          {/* „Ukloni" je odvojeno od „Sačuvaj", ne uz njega: dva dugmeta na
              osam piksela razmaka, od kojih jedno briše uslugu, na telefonu su
              ista meta. Potvrda je isti postupak kao kod blokiranja broja. */}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={pending}
            >
              {sr.settings.saveService}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-[#B3261E] hover:text-[#B3261E]"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(sr.settings.removeServiceConfirm)) {
                  return;
                }
                call(() => deleteServiceEntry(service.id));
              }}
            >
              {sr.settings.removeService}
            </Button>
          </div>
        </form>
      ))}

      <form
        action={submit(saveServiceEntry)}
        className="space-y-2 rounded-2xl border border-dashed border-[#DED5C7] p-3"
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

        <Button
          type="submit"
          size="sm"
          className="rounded-full"
          disabled={pending}
        >
          {sr.settings.addService}
        </Button>
      </form>

      <Feedback state={state} />
    </div>
  );
}


/**
 * Adresa kalendara i uputstvo kako se zakači.
 *
 * Adresa se prikazuje cela, i namerno: vlasnica je nalepljuje u kalendar
 * aplikaciju, pa mora da se vidi i kad kopiranje ne uspe. `webcal://` je isti
 * put, samo shema koju telefon prepozna kao „pretplati me na ovo“ umesto kao
 * „preuzmi fajl“.
 */
export function CalendarFeed({
  token,
  origin,
}: {
  token: string | null;
  origin: string;
}) {
  const [pending, startTransition] = useTransition();
  const [copyFailed, setCopyFailed] = useState(false);

  // Nastavak `.ics` je deo aplikacija jedini nagoveštaj da je na drugom
  // kraju kalendar; `Content-Type` ne gledaju sve. Ruta prima i goli
  // token, pa stare pretplate nastavljaju da rade.
  const httpUrl = token ? `${origin}/api/kalendar/salon/${token}.ics` : null;
  const webcalUrl = httpUrl
    ? httpUrl.replace(/^https?:\/\//, "webcal://")
    : null;

  if (!token || !httpUrl || !webcalUrl) {
    return (
      <div className="space-y-3">
        <p className="text-[#554C44] text-sm">
          {sr.settings.calendarHint}
        </p>
        <Button
          type="button"
          className="rounded-full"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await enableCalendarFeed();
            });
          }}
        >
          {pending ? sr.settings.calendarEnabling : sr.settings.calendarEnable}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[#554C44] text-sm">{sr.settings.calendarHint}</p>

      <p className="rounded-xl bg-[#FBF7F0] p-3 font-mono text-xs break-all">
        {httpUrl}
      </p>

      <div className="flex flex-wrap gap-2">
        {/* Sidro, ne dugme: `webcal://` predaje telefon kalendar aplikaciji,
            a to ume samo prava veza. Stil je isti kao kod dugmeta pored. */}
        <a
          href={webcalUrl}
          className={cn(buttonVariants({ size: "sm" }), "rounded-full")}
        >
          {sr.settings.calendarSubscribe}
        </a>

        <CopyButton
          value={httpUrl}
          label={sr.settings.calendarCopy}
          onFailed={setCopyFailed}
        />
      </div>

      {copyFailed ? (
        <p role="alert" className="text-[#B3261E] text-xs">
          {sr.settings.copyFailed}
        </p>
      ) : null}

      <div className="text-[#554C44] space-y-2 pt-1 text-xs">
        <p className="font-medium">{sr.settings.calendarStepsTitle}</p>
        <p>{sr.settings.calendarStepsIphone}</p>
        <p>{sr.settings.calendarStepsAndroid}</p>
        <p>{sr.settings.calendarDelay}</p>
        <p className="text-[#B3261E]">
          {sr.settings.calendarSecretWarning}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await enableCalendarFeed();
            });
          }}
        >
          {sr.settings.calendarRotate}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          className="text-[#B3261E] hover:text-[#B3261E]"
          onClick={() => {
            startTransition(async () => {
              await disableCalendarFeed();
            });
          }}
        >
          {sr.settings.calendarDisable}
        </Button>
      </div>
    </div>
  );
}

/**
 * Javni link salona, sa kopiranjem.
 *
 * Ovo je jedina stvar sa cele strane koja stalno treba drugde — u Instagram
 * bio, u automatski odgovor, u poruku klijentu. Do sada se morao označiti
 * prstom po adresi koja se lomi u tri reda, što na telefonu skoro nikad ne
 * uhvati tačno ceo tekst.
 *
 * „Otvori" stoji pored jer je jedini način da vlasnica vidi ono što vidi
 * klijent, a da se ne odjavi iz svog naloga.
 */
export function PublicLink({ url }: { url: string }) {
  const [copyFailed, setCopyFailed] = useState(false);

  return (
    <section className="rounded-[22px] bg-[#8C1D3F] p-5 text-[#FBF7F0]">
      <span className="text-[11px] font-bold tracking-[0.16em] uppercase opacity-90">
        {sr.settings.linkTitle}
      </span>

      <p className="pt-2 text-base font-semibold break-all">{url}</p>

      <div className="flex flex-wrap gap-2 pt-4">
        <CopyButton
          value={url}
          label={sr.settings.linkCopy}
          onFailed={setCopyFailed}
          className="h-11 border-transparent bg-[#FBF7F0] px-5 text-[#211D1A] hover:bg-white hover:text-[#211D1A]"
        />

        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex h-11 items-center rounded-full border border-[#FBF7F0]/45 px-5 text-sm font-medium"
        >
          {sr.settings.linkOpen}
        </a>
      </div>

      <p className="pt-3 text-xs leading-relaxed opacity-90">
        {sr.settings.linkHint}
      </p>

      {copyFailed ? (
        <p role="alert" className="pt-2 text-xs font-medium">
          {sr.settings.copyFailed}
        </p>
      ) : null}

    </section>
  );
}
