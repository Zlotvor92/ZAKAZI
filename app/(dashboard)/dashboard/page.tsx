import Link from "next/link";
import { DayList } from "@/components/calendar/day-list";
import { WeekStrip, type StripDay } from "@/components/calendar/week-strip";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  getAppointmentsInRange,
  LIVE_STATUSES,
  type DashboardAppointment,
} from "@/lib/db/appointments";
import { getCurrentTenant } from "@/lib/db/tenants";
import { getWorkingHours } from "@/lib/db/working-hours";
import {
  addDays,
  currentDateInTimeZone,
  dayBoundsInTimeZone,
  instantInTimeZone,
  isoWeekDates,
  isoWeekday,
  startOfIsoWeek,
} from "@/lib/domain/calendar";
import { sr } from "@/lib/i18n/sr";
import { signOut } from "./actions";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PageProps = { searchParams: Promise<{ dan?: string }> };

function dayHeading(date: string): string {
  const day = Number(date.slice(8, 10));
  const month = sr.calendar.months[Number(date.slice(5, 7)) - 1];

  return `${sr.calendar.weekdaysShort[isoWeekday(date) - 1]}, ${day}. ${month}`;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  // Radno vreme ne zavisi od salona — RLS ga ionako sužava — pa ga nema
  // razloga čekati u redu iza njega. Svaki obilazak manje se vidi na telefonu.
  const [tenant, workingHours] = await Promise.all([
    getCurrentTenant(),
    getWorkingHours(),
  ]);

  if (!tenant) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-3xl p-4">
        <p className="text-muted-foreground py-8 text-sm">
          {sr.dashboard.noTenant}
        </p>
      </main>
    );
  }

  const today = currentDateInTimeZone(new Date(), tenant.timezone);
  const requested = (await searchParams).dan;
  const selected = requested && DATE_PATTERN.test(requested) ? requested : today;

  const weekDates = isoWeekDates(selected);
  const week = {
    from: instantInTimeZone(weekDates[0]!, 0, tenant.timezone),
    to: dayBoundsInTimeZone(weekDates[6]!, tenant.timezone).to,
  };

  const appointments = await getAppointmentsInRange(week);

  const live = appointments.filter((appointment) =>
    LIVE_STATUSES.includes(appointment.status),
  );

  function onDate(date: string): DashboardAppointment[] {
    const bounds = dayBoundsInTimeZone(date, tenant!.timezone);

    return live.filter((appointment) => {
      const startAt = new Date(appointment.start_at);
      return startAt >= bounds.from && startAt < bounds.to;
    });
  }

  const days: StripDay[] = weekDates.map((date) => ({
    date,
    appointments: onDate(date).length,
    working: workingHours.some(
      (interval) => interval.weekday === isoWeekday(date),
    ),
  }));

  const selectedDay = days.find((day) => day.date === selected)!;
  const ofDay = onDate(selected);
  const previousWeek = addDays(startOfIsoWeek(selected), -7);
  const nextWeek = addDays(startOfIsoWeek(selected), 7);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl p-4">
      <header className="flex items-center justify-between gap-4 pb-3">
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
          {tenant.name}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/dashboard/podesavanja"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {sr.settings.open}
          </Link>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              {sr.dashboard.signOut}
            </Button>
          </form>
        </div>
      </header>

      <nav className="flex items-center justify-between gap-2 pb-2">
        <Link
          href={`/dashboard?dan=${previousWeek}`}
          aria-label={sr.dashboard.previousWeek}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          ‹
        </Link>
        <Link
          href={`/dashboard?dan=${today}`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {sr.dashboard.today}
        </Link>
        <Link
          href={`/dashboard?dan=${nextWeek}`}
          aria-label={sr.dashboard.nextWeek}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          ›
        </Link>
      </nav>

      <WeekStrip days={days} selected={selected} today={today} />

      <section className="pt-4">
        <div className="flex items-center justify-between gap-3 pb-1">
          <h2 className="text-sm font-semibold">{dayHeading(selected)}</h2>
          <Link
            href={`/dashboard/termin/novi?dan=${selected}`}
            className={buttonVariants({ size: "sm" })}
          >
            {sr.dashboard.addAppointment}
          </Link>
        </div>

        {ofDay.length > 0 ? (
          <DayList appointments={ofDay} timeZone={tenant.timezone} />
        ) : (
          <p className="text-muted-foreground py-6 text-sm">
            {selectedDay.working
              ? sr.dashboard.emptyDay
              : sr.dashboard.notWorking}
          </p>
        )}
      </section>
    </main>
  );
}
