"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublicBookingData, PublicService } from "@/lib/db/public-booking";
import {
  buildAvailability,
  type DayAvailability,
  type Slot,
} from "@/lib/domain/availability";
import { isoWeekday } from "@/lib/domain/calendar";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";
import { submitBooking, type BookingState } from "./actions";

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) {
    return `${rest} ${sr.booking.minuteShort}`;
  }

  return rest === 0
    ? `${hours} ${sr.booking.hourShort}`
    : `${hours} ${sr.booking.hourShort} ${rest} ${sr.booking.minuteShort}`;
}

/** `null` za besplatnu uslugu — „0 RSD" izgleda kao greška, ne kao poklon. */
function formatPrice(rsd: number): string | null {
  if (rsd === 0) {
    return null;
  }
  return `${new Intl.NumberFormat("sr-RS").format(rsd)} ${sr.booking.currency}`;
}

/**
 * iPhone otvori ponudu „Dodaj u kalendar" sam čim se `.ics` fajl otvori;
 * Android ga samo preuzme i tu stane dok korisnica sama ne otvori preuzeto.
 * Uputstvo mora da zna razliku, ili je pola vremena pogrešno.
 *
 * Poziva se samo unutar potvrde zakazivanja, koja nikad ne postoji na
 * serveru — do tog ekrana se stiže isključivo posle uspešne akcije u
 * pregledaču, pa `navigator` ovde sigurno postoji.
 */
function addToCalendarSteps(): string {
  const ua = navigator.userAgent;

  if (/iPhone|iPad|iPod/.test(ua)) {
    return sr.booking.addToCalendarStepsIos;
  }
  if (/Android/.test(ua)) {
    return sr.booking.addToCalendarStepsAndroid;
  }
  return sr.booking.addToCalendarStepsGeneric;
}

/** „2026-08-17" → „17.08". Datum se u Srbiji čita danom pa mesecom. */
function dayAndMonth(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

function dayLabel(date: string, today: string, tomorrow: string): string {
  if (date === today) {
    return sr.booking.today;
  }
  if (date === tomorrow) {
    return sr.booking.tomorrow;
  }
  return sr.calendar.weekdaysShort[isoWeekday(date) - 1]!;
}

function ChosenRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onChange}>
        {sr.booking.change}
      </Button>
    </div>
  );
}

export function BookingFlow({ data }: { data: PublicBookingData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [service, setService] = useState<PublicService | null>(
    data.services.length === 1 ? data.services[0]! : null,
  );
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  // `null` znači „još nije birano" ili „svejedno mi je"; razliku nosi
  // `staffPicked`, jer i jedno i drugo daju prazan izbor osobe.
  const [staffId, setStaffId] = useState<string | null>(null);
  const [staffPicked, setStaffPicked] = useState(false);
  const [state, setState] = useState<BookingState>({ status: "idle" });
  // Uputstvo se drži skriveno dok se dugme ne dodirne. Pre dodira je samo
  // buka ispod dugmeta koje treba pritisnuti; posle dodira je jedino što
  // pomaže kad se fajl preuzeo a ništa se nije otvorilo.
  const [calendarTapped, setCalendarTapped] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);

  const timeZone = data.tenant.timezone;

  /**
   * Tastatura pokrije donju trećinu ekrana, a dugme za slanje stoji ispod
   * poslednjeg polja — na 375×812 završi tačno iza nje, pa izgleda kao da
   * forme nema kraj. Odlaganje čeka da se tastatura otvori: bez njega se
   * skroluje po staroj visini prozora i dugme opet ostane ispod.
   */
  function revealSubmit() {
    window.setTimeout(() => {
      submitRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }, 300);
  }

  function restart() {
    setState({ status: "idle" });
    setService(data.services.length === 1 ? data.services[0]! : null);
    setDate(null);
    setSlot(null);
    setStaffId(null);
    setStaffPicked(false);
  }

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await submitBooking(formData);
      setState(result);

      // Termin je upravo zauzet — spisak slobodnih koji je stigao sa servera
      // od ovog trenutka laže, i za onog ko zakazuje još jedan, i za onog ko
      // je dobio odbijenicu pa bira ponovo.
      router.refresh();
    });
  }

  // Uslugu ne mora da radi svako; osoba koja je ne radi ne sme ni da se ponudi.
  const eligibleStaff = useMemo(
    () =>
      service
        ? data.staff.filter((person) =>
            person.service_ids.includes(service.id),
          )
        : [],
    [service, data.staff],
  );

  // Termini zavise od usluge: duža usluga ne staje svuda gde staje kraća.
  const days: DayAvailability[] = useMemo(() => {
    if (!service) {
      return [];
    }

    // Bez izabrane osobe termin je slobodan ako je slobodan bilo kome ko tu
    // uslugu radi — spajaju se rasporedi, ne preseca se.
    const forWhom = staffId
      ? eligibleStaff.filter((person) => person.id === staffId)
      : eligibleStaff;

    const perPerson = forWhom.map((person) =>
      buildAvailability({
        timeZone,
        fromDate: data.from_date,
        toDate: data.to_date,
        blocks: person.blocks.map((block) => ({
          weekday: block.weekday,
          startMinute: block.start_minute,
          endMinute: block.end_minute,
          slotMinutes: block.slot_minutes,
        })),
        busy: person.busy.map((range) => ({
          startAt: new Date(range.start_at),
          endAt: new Date(range.end_at),
        })),
        serviceMinutes: service.duration_min,
        now: new Date(data.now),
        minLeadMin: data.tenant.min_lead_minutes,
      }),
    );

    if (perPerson.length <= 1) {
      return perPerson[0] ?? [];
    }

    const byDate = new Map<string, Map<number, Slot>>();
    for (const days of perPerson) {
      for (const day of days) {
        const slots = byDate.get(day.date) ?? new Map<number, Slot>();
        for (const one of day.slots) {
          slots.set(one.startAt.getTime(), one);
        }
        byDate.set(day.date, slots);
      }
    }

    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, slots]) => ({
        date,
        slots: [...slots.values()].sort(
          (a, b) => a.startAt.getTime() - b.startAt.getTime(),
        ),
      }));
  }, [service, data, timeZone, staffId, eligibleStaff]);

  const openDays = useMemo(
    () => days.filter((day) => day.slots.length > 0),
    [days],
  );

  const tomorrow = days[1]?.date ?? "";
  const chosenDay = openDays.find((day) => day.date === date) ?? null;

  if (state.status === "booked") {
    const startAt = new Date(state.appointment.startAt);
    const endAt = new Date(state.appointment.endAt);
    const priceLabel = formatPrice(state.appointment.priceRsd);

    return (
      <div className="space-y-6 py-6 text-center">
        <div className="space-y-1">
          {/* Jednokratan „uspelo je" trenutak — čisto CSS/SVG, bez biblioteke. */}
          <div className="flex justify-center pb-1">
            <span className="bg-primary text-primary-foreground animate-in zoom-in-50 fade-in flex size-16 items-center justify-center rounded-full duration-500">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-8"
                aria-hidden="true"
              >
                <path d="M5 12l5 5L19 8" />
              </svg>
            </span>
          </div>
          <h2 className="text-xl font-semibold">{sr.booking.confirmedTitle}</h2>
          <p className="text-muted-foreground text-sm">
            {sr.booking.confirmedBody}
          </p>
        </div>

        <dl className="bg-accent border-border space-y-1 rounded-xl border p-4 text-sm">
          <div className="font-medium">{state.appointment.serviceName}</div>
          <div className="tabular-nums">
            {formatInTimeZone(startAt, timeZone, "dd.MM.yyyy.")}{" "}
            {formatInTimeZone(startAt, timeZone, "HH:mm")}–
            {formatInTimeZone(endAt, timeZone, "HH:mm")}
          </div>
          {priceLabel ? (
            <div className="text-brand font-semibold">{priceLabel}</div>
          ) : null}
        </dl>

        <div className="space-y-2">
          {/* Jedini podsetnik koji ne košta ništa: telefon sam javi. Zato ovo
              dugme sme da bude nametljivo — jedini put na strani gde je to
              namerno. */}
          <div className="relative">
            <span
              aria-hidden="true"
              className="bg-primary/50 pointer-events-none absolute inset-0 animate-ping rounded-xl"
            />
            <a
              href={`/api/kalendar?${new URLSearchParams({
                pocetak: state.appointment.startAt,
                kraj: state.appointment.endAt,
                usluga: state.appointment.serviceName,
                salon: data.tenant.name,
              }).toString()}`}
              onClick={() => setCalendarTapped(true)}
              className="border-primary bg-primary text-primary-foreground hover:bg-primary/90 relative inline-flex h-12 w-full items-center justify-center rounded-xl border text-sm font-medium transition-colors"
            >
              {sr.booking.addToCalendar}
            </a>
          </div>
          <p className="text-muted-foreground text-xs">
            {sr.booking.addToCalendarHint}
          </p>
          {calendarTapped ? (
            <p className="border-border rounded-lg border p-3 text-sm">
              <span className="font-medium">
                {sr.booking.addToCalendarStepsTitle}
              </span>{" "}
              {addToCalendarSteps()}
            </p>
          ) : null}
        </div>

        {/* Link ka otkazivanju je već u podnožju strane, ispod ovog toka —
            nema potrebe da stoji dvaput na istom ekranu. */}
        <Button type="button" variant="outline" onClick={restart}>
          {sr.booking.bookAnother}
        </Button>
      </div>
    );
  }

  if (!service) {
    return (
      <section className="space-y-3 py-4">
        <h2 className="text-base font-semibold">{sr.booking.chooseService}</h2>
        <ul className="space-y-2">
          {data.services.map((option) => {
            const priceLabel = formatPrice(option.price_rsd);

            return (
              <li key={option.id}>
                <button
                  type="button"
                  data-testid="service-option"
                  onClick={() => setService(option)}
                  className="border-border hover:border-primary hover:bg-accent flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {option.name}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {formatDuration(option.duration_min)}
                    </span>
                  </span>
                  {priceLabel ? (
                    <span className="text-brand shrink-0 text-sm font-semibold tabular-nums">
                      {priceLabel}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  // Osoba se bira samo kad ima između koga. Salon sa jednom osobom nikad ne
  // vidi ovaj korak, pa mu se tok zakazivanja nije produžio ni za jedan dodir.
  if (eligibleStaff.length > 1 && !staffPicked) {
    return (
      <section className="space-y-3 py-4">
        <h2 className="text-base font-semibold">{sr.booking.chooseStaff}</h2>
        <ul className="space-y-2">
          {eligibleStaff.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                data-testid="staff-option"
                onClick={() => {
                  setStaffId(person.id);
                  setStaffPicked(true);
                }}
                className="border-border hover:border-primary hover:bg-accent flex min-h-16 w-full items-center rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors"
              >
                {person.name}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => {
                setStaffId(null);
                setStaffPicked(true);
              }}
              className="border-border hover:border-primary hover:bg-accent flex min-h-16 w-full flex-col items-start justify-center rounded-xl border px-4 py-3 text-left transition-colors"
            >
              <span className="text-sm font-medium">{sr.booking.anyStaff}</span>
              <span className="text-muted-foreground text-xs">
                {sr.booking.anyStaffHint}
              </span>
            </button>
          </li>
        </ul>
      </section>
    );
  }

  const staffSummary =
    eligibleStaff.find((person) => person.id === staffId)?.name ??
    sr.booking.anyStaff;

  const serviceSummary = [
    service.name,
    formatDuration(service.duration_min),
    formatPrice(service.price_rsd),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <div className="divide-border divide-y py-2">
      {data.services.length > 1 ? (
        <ChosenRow
          label={sr.booking.chooseService}
          value={serviceSummary}
          onChange={() => {
            setService(null);
            setDate(null);
            setSlot(null);
            setStaffId(null);
            setStaffPicked(false);
          }}
        />
      ) : (
        <div className="py-2 text-sm font-medium">{serviceSummary}</div>
      )}

      {eligibleStaff.length > 1 ? (
        <ChosenRow
          label={sr.booking.chooseStaff}
          value={staffSummary}
          onChange={() => {
            setStaffPicked(false);
            setDate(null);
            setSlot(null);
          }}
        />
      ) : null}

      {date && slot ? (
        <ChosenRow
          label={sr.booking.chooseTime}
          value={`${formatInTimeZone(new Date(slot), timeZone, "dd.MM.")} u ${formatInTimeZone(new Date(slot), timeZone, "HH:mm")}`}
          onChange={() => setSlot(null)}
        />
      ) : null}

      {openDays.length === 0 ? (
        <p className="text-muted-foreground py-6 text-sm">{sr.booking.noSlots}</p>
      ) : null}

      {openDays.length > 0 && !slot ? (
        <section className="space-y-3 py-4">
          <h2 className="text-base font-semibold">{sr.booking.chooseDay}</h2>

          {/* Traka dana: prst prevlači, ne bira iz padajuće liste. */}
          <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
            {openDays.map((day) => (
              <li key={day.date} className="snap-start">
                <button
                  type="button"
                  data-testid="day-option"
                  onClick={() => setDate(day.date)}
                  aria-pressed={day.date === date}
                  className={cn(
                    "border-border flex min-h-16 w-[4.5rem] shrink-0 flex-col items-center justify-center rounded-xl border transition-colors",
                    day.date === date
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-accent",
                  )}
                >
                  <span className="text-[0.6875rem] leading-tight">
                    {dayLabel(day.date, data.from_date, tomorrow)}
                  </span>
                  {/* Sa mesecom, jer spisak ume da pređe iz jednog u drugi i
                      goli broj tada ne kaže dovoljno. */}
                  <span className="text-base leading-tight font-semibold tabular-nums">
                    {dayAndMonth(day.date)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {chosenDay && !slot ? (
        <section className="space-y-3 py-4">
          <h2 className="text-base font-semibold">{sr.booking.chooseTime}</h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {chosenDay.slots.map((option: Slot) => {
              const value = option.startAt.toISOString();
              return (
                <li key={value}>
                  <button
                    type="button"
                    data-testid="slot-option"
                    onClick={() => setSlot(value)}
                    className="border-border hover:border-primary hover:bg-accent min-h-12 w-full rounded-xl border text-sm font-medium tabular-nums transition-colors"
                  >
                    {formatInTimeZone(option.startAt, timeZone, "HH:mm")}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {slot ? (
        <form action={onSubmit} className="space-y-4 py-4">
          <h2 className="text-base font-semibold">{sr.booking.yourDetails}</h2>

          <input type="hidden" name="slug" value={data.tenant.slug} />
          <input type="hidden" name="serviceId" value={service.id} />
          <input type="hidden" name="staffId" value={staffId ?? ""} />
          <input type="hidden" name="startAt" value={slot} />

          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              {sr.booking.nameLabel}
            </label>
            <Input
              id="name"
              name="name"
              required
              autoComplete="name"
              maxLength={80}
              placeholder={sr.booking.namePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="phone" className="text-sm font-medium">
              {sr.booking.phoneLabel}
            </label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder={sr.booking.phonePlaceholder}
              aria-describedby="phone-hint"
              onFocus={revealSubmit}
            />
            <p id="phone-hint" className="text-muted-foreground text-xs">
              {sr.booking.phoneHint}
            </p>
          </div>

          {state.status === "error" ? (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          ) : null}

          <Button
            ref={submitRef}
            type="submit"
            className="h-12 w-full scroll-mb-4"
            disabled={pending}
          >
            {pending ? sr.booking.submitting : sr.booking.submit}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
