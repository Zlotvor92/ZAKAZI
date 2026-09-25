"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { display } from "@/app/fonts";
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

/**
 * Pritisak koji se vidi. Na telefonu nema pokazivača ni `hover`-a, pa je ovo
 * jedini trenutak u kom aplikacija može da odgovori na dodir — bez njega se
 * čini da dugme nije primilo prst, pa se dodirne drugi put.
 *
 * `motion-reduce` gasi pomeranje: ko je u podešavanjima tražio manje pokreta,
 * traži ga i ovde.
 */
const pressable =
  "transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100";

/** Novi korak ulazi odozdo. Korak koji bane bez pokreta izgleda kao greška. */
const enter =
  "animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none";

const microLabel =
  "text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase";

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

/** `null` za besplatnu uslugu — „0" izgleda kao greška, ne kao poklon. */
function formatAmount(rsd: number): string | null {
  if (rsd === 0) {
    return null;
  }
  return new Intl.NumberFormat("sr-RS").format(rsd);
}

/** Sa valutom: u spisku usluga piše samo broj, jer ispod stoji „Cene u RSD". */
function formatPrice(rsd: number): string | null {
  const amount = formatAmount(rsd);
  return amount === null ? null : `${amount} ${sr.booking.currency}`;
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

function StepHeading({ children }: { children: React.ReactNode }) {
  return <h2 className={`${microLabel} pb-1`}>{children}</h2>;
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
    <div className="flex items-center justify-between gap-3 border-b border-[#E4DAC9] py-3">
      <div className="min-w-0">
        <div className={microLabel}>{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
      <button
        type="button"
        onClick={onChange}
        className={cn(
          "shrink-0 px-2 py-3 text-[11px] font-bold tracking-[0.14em] text-[#8C1D3F] uppercase",
          pressable,
        )}
      >
        {sr.booking.change}
      </button>
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
  }

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      // Sam poziv ume da padne: prekinuta mreža u liftu, ili greška na
      // serveru. Bez `catch`-a to je odbijeno obećanje koje React odnese na
      // granicu greške, pa klijentkinja usred zakazivanja dobije stranu
      // „Nešto je puklo" umesto jedne rečenice ispod dugmeta.
      try {
        const result = await submitBooking(formData);
        setState(result);
      } catch {
        setState({ status: "error", message: sr.error.unreachable });
      }

      // Termin je upravo zauzet — spisak slobodnih koji je stigao sa servera
      // od ovog trenutka laže, i za onog ko zakazuje još jedan, i za onog ko
      // je dobio odbijenicu pa bira ponovo.
      router.refresh();
    });
  }

  // Termini zavise od usluge: duža usluga ne staje svuda gde staje kraća.
  const days: DayAvailability[] = useMemo(() => {
    if (!service) {
      return [];
    }

    return buildAvailability({
      timeZone,
      fromDate: data.from_date,
      toDate: data.to_date,
      blocks: data.blocks.map((block) => ({
        weekday: block.weekday,
        startMinute: block.start_minute,
        endMinute: block.end_minute,
        slotMinutes: block.slot_minutes,
      })),
      busy: data.busy.map((range) => ({
        startAt: new Date(range.start_at),
        endAt: new Date(range.end_at),
      })),
      serviceMinutes: service.duration_min,
      now: new Date(data.now),
      minLeadMin: data.tenant.min_lead_minutes,
      breakOverrunMin: data.tenant.break_overrun_min,
      shiftOverrunMin: data.tenant.shift_overrun_min,
    });
  }, [service, data, timeZone]);

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
      <div className={cn("flex flex-col gap-6 py-2", enter)}>
        <div className="flex flex-col items-start gap-3">
          {/* Jednokratan „uspelo je" trenutak — čisto CSS/SVG, bez biblioteke. */}
          <span className="animate-in zoom-in-50 fade-in flex size-14 items-center justify-center rounded-full bg-[#8C1D3F] text-[#FBF7F0] duration-500 motion-reduce:animate-none">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-7"
              aria-hidden="true"
            >
              <path d="M5 12l5 5L19 8" />
            </svg>
          </span>
          <h2 className={`${display.className} text-[30px] leading-tight`}>
            {sr.booking.confirmedTitle}
          </h2>
          <p className="text-sm leading-relaxed text-[#554C44]">
            {sr.booking.confirmedBody}
          </p>
        </div>

        <dl className="flex flex-col border-t-2 border-[#211D1A] pt-3">
          <div className="flex items-baseline justify-between gap-4 border-t border-[#E4DAC9] py-2.5 first:border-t-0">
            <dt className={microLabel}>{sr.booking.summaryService}</dt>
            <dd className="text-right text-[13.5px] font-medium">
              {state.appointment.serviceName}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-[#E4DAC9] py-2.5">
            <dt className={microLabel}>{sr.booking.summaryWhen}</dt>
            <dd className="text-right text-[13.5px] font-medium tabular-nums">
              {formatInTimeZone(startAt, timeZone, "dd.MM.yyyy.")}{" "}
              {formatInTimeZone(startAt, timeZone, "HH:mm")}–
              {formatInTimeZone(endAt, timeZone, "HH:mm")}
            </dd>
          </div>
          {priceLabel ? (
            <div className="flex items-baseline justify-between gap-4 border-t border-[#E4DAC9] py-2.5">
              <dt className={microLabel}>{sr.booking.summaryPrice}</dt>
              <dd
                className={`${display.className} text-right text-lg tabular-nums`}
              >
                {priceLabel}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-col gap-2">
          {/* Jedini podsetnik koji ne košta ništa: telefon sam javi. Zato ovo
              dugme sme da bude nametljivo — jedini put na strani gde je to
              namerno. */}
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 animate-ping bg-[#8C1D3F]/40 motion-reduce:animate-none"
            />
            <a
              href={`/api/kalendar?${new URLSearchParams({
                pocetak: state.appointment.startAt,
                kraj: state.appointment.endAt,
                usluga: state.appointment.serviceName,
                salon: data.tenant.name,
              }).toString()}`}
              onClick={() => setCalendarTapped(true)}
              className={cn(
                "relative flex h-14 w-full items-center justify-center bg-[#8C1D3F] text-xs font-bold tracking-[0.18em] text-[#FBF7F0] uppercase active:bg-[#6E162F]",
                pressable,
              )}
            >
              {sr.booking.addToCalendar}
            </a>
          </div>
          <p className="text-xs leading-relaxed text-[#6B6055]">
            {sr.booking.addToCalendarHint}
          </p>
          {calendarTapped ? (
            <p
              className={cn(
                "bg-[#F2EADC] px-4 py-3 text-[13px] leading-relaxed",
                enter,
              )}
            >
              <span className="font-semibold">
                {sr.booking.addToCalendarStepsTitle}
              </span>{" "}
              {addToCalendarSteps()}
            </p>
          ) : null}
        </div>

        {/* Link ka otkazivanju je već u podnožju strane, ispod ovog toka —
            nema potrebe da stoji dvaput na istom ekranu. */}
        <button
          type="button"
          onClick={restart}
          className={cn(
            "flex h-12 w-full items-center justify-center border border-[#211D1A] text-xs font-bold tracking-[0.18em] uppercase active:bg-[#F2EADC]",
            pressable,
          )}
        >
          {sr.booking.bookAnother}
        </button>
      </div>
    );
  }

  if (!service) {
    return (
      <section className={cn("flex flex-col", enter)}>
        <h2 className={`${microLabel} border-b-2 border-[#211D1A] pb-2.5`}>
          {sr.booking.chooseService}
        </h2>

        <ul className="flex flex-col">
          {data.services.map((option) => {
            const amount = formatAmount(option.price_rsd);

            return (
              <li key={option.id}>
                <button
                  type="button"
                  data-testid="service-option"
                  onClick={() => setService(option)}
                  className={cn(
                    "flex min-h-[76px] w-full items-baseline justify-between gap-4 border-b border-[#E4DAC9] px-1 py-4 text-left active:bg-[#F2EADC]",
                    pressable,
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span
                      className={`${display.className} block text-[21px] leading-tight`}
                    >
                      {option.name}
                    </span>
                    <span className={microLabel}>
                      {formatDuration(option.duration_min)}
                    </span>
                    {option.description ? (
                      <span className="block text-[14px] leading-snug whitespace-pre-line text-[#8C1D3F]">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {amount ? (
                    <span
                      className={`${display.className} shrink-0 text-[19px] tabular-nums`}
                    >
                      {amount}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        <span className={`${microLabel} pt-2.5`}>{sr.booking.pricesInRsd}</span>
      </section>
    );
  }

  const serviceSummary = [
    service.name,
    formatDuration(service.duration_min),
    formatPrice(service.price_rsd),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <div className="flex flex-col">
      {data.services.length > 1 ? (
        <ChosenRow
          label={sr.booking.chooseService}
          value={serviceSummary}
          onChange={() => {
            setService(null);
            setDate(null);
            setSlot(null);
          }}
        />
      ) : (
        <div className="border-b border-[#E4DAC9] py-3 text-sm font-medium">
          {serviceSummary}
        </div>
      )}

      {date && slot ? (
        <ChosenRow
          label={sr.booking.chooseTime}
          value={`${formatInTimeZone(new Date(slot), timeZone, "dd.MM.")} u ${formatInTimeZone(new Date(slot), timeZone, "HH:mm")}`}
          onChange={() => setSlot(null)}
        />
      ) : null}

      {openDays.length === 0 ? (
        <p className="py-6 text-sm leading-relaxed text-[#554C44]">
          {sr.booking.noSlots}
        </p>
      ) : null}

      {openDays.length > 0 && !slot ? (
        <section className={cn("flex flex-col gap-2.5 py-4", enter)}>
          <StepHeading>{sr.booking.chooseDay}</StepHeading>

          {/* Traka dana: prst prevlači, ne bira iz padajuće liste. */}
          <ul className="-mx-6 flex snap-x gap-1.5 overflow-x-auto px-6 pb-1">
            {openDays.map((day) => (
              <li key={day.date} className="snap-start">
                <button
                  type="button"
                  data-testid="day-option"
                  onClick={() => setDate(day.date)}
                  aria-pressed={day.date === date}
                  className={cn(
                    "flex min-h-[66px] w-[4.25rem] shrink-0 flex-col items-center justify-center gap-1 border",
                    day.date === date
                      ? "border-[#211D1A] bg-[#211D1A] text-[#FBF7F0]"
                      : "border-[#E4DAC9] bg-white/60 active:bg-[#F2EADC]",
                    pressable,
                  )}
                >
                  <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase">
                    {dayLabel(day.date, data.from_date, tomorrow)}
                  </span>
                  {/* Sa mesecom, jer spisak ume da pređe iz jednog u drugi i
                      goli broj tada ne kaže dovoljno. */}
                  <span
                    className={`${display.className} text-[17px] leading-none tabular-nums`}
                  >
                    {dayAndMonth(day.date)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {chosenDay && !slot ? (
        <section className={cn("flex flex-col gap-2.5 py-4", enter)}>
          <StepHeading>{sr.booking.chooseTime}</StepHeading>
          <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {chosenDay.slots.map((option: Slot, index) => {
              const value = option.startAt.toISOString();

              return (
                <li
                  key={value}
                  // Satnica se slaže red po red umesto da sva bljesne odjednom.
                  // Kašnjenje je ograničeno, inače bi dan sa trideset termina
                  // čekao skoro sekundu da se iscrta do kraja.
                  style={{ animationDelay: `${Math.min(index, 11) * 25}ms` }}
                  className="animate-in fade-in zoom-in-95 fill-mode-both duration-200 motion-reduce:animate-none"
                >
                  <button
                    type="button"
                    data-testid="slot-option"
                    onClick={() => setSlot(value)}
                    className={cn(
                      "min-h-12 w-full border border-[#E4DAC9] bg-white/60 text-sm font-semibold tabular-nums active:bg-[#F2EADC]",
                      pressable,
                    )}
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
        <form action={onSubmit} className={cn("flex flex-col gap-4 py-4", enter)}>
          <StepHeading>{sr.booking.yourDetails}</StepHeading>

          <input type="hidden" name="slug" value={data.tenant.slug} />
          <input type="hidden" name="serviceId" value={service.id} />
          <input type="hidden" name="startAt" value={slot} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className={microLabel}>
              {sr.booking.nameLabel}
            </label>
            <input
              id="name"
              name="name"
              required
              autoComplete="name"
              maxLength={80}
              placeholder={sr.booking.namePlaceholder}
              className="h-12 w-full border-b border-[#211D1A] bg-transparent text-base transition-colors outline-none placeholder:text-[#A2988C] focus:border-[#8C1D3F]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="phone" className={microLabel}>
              {sr.booking.phoneLabel}
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder={sr.booking.phonePlaceholder}
              aria-describedby="phone-hint"
              onFocus={revealSubmit}
              className="h-12 w-full border-b border-[#211D1A] bg-transparent text-base transition-colors outline-none placeholder:text-[#A2988C] focus:border-[#8C1D3F]"
            />
            <p id="phone-hint" className="text-xs leading-relaxed text-[#6B6055]">
              {sr.booking.phoneHint}
            </p>
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
            ref={submitRef}
            type="submit"
            disabled={pending}
            className={cn(
              "flex h-14 w-full scroll-mb-4 items-center justify-center bg-[#211D1A] text-xs font-bold tracking-[0.18em] text-[#FBF7F0] uppercase active:bg-[#3A332D] disabled:opacity-60",
              pressable,
            )}
          >
            {pending ? sr.booking.submitting : sr.booking.submit}
          </button>
        </form>
      ) : null}
    </div>
  );
}
