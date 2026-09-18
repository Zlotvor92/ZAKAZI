import { ChevronLeft, ChevronRight, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { display } from "@/app/fonts";
import { DayList } from "@/components/calendar/day-list";
import { WeekStrip, type StripDay } from "@/components/calendar/week-strip";
import { TenantSwitcher } from "@/components/dashboard/tenant-switcher";
import { Button } from "@/components/ui/button";
import {
  getDashboardWeek,
  LIVE_STATUSES,
  type DashboardAppointment,
} from "@/lib/db/appointments";
import { isPlatformOwner } from "@/lib/db/admin";
import { getMyTenants } from "@/lib/db/tenants";
import {
  addDays,
  dayBoundsInTimeZone,
  isoWeekDates,
  isoWeekday,
} from "@/lib/domain/calendar";
import { pluralize } from "@/lib/domain/plural";
import { daysUntil, subscriptionState } from "@/lib/domain/subscription";
import { dayFullyOff, timeOffOfDay } from "@/lib/domain/time-off";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";
import { selectedTenantId } from "@/lib/tenant";
import { signOut, switchTenant } from "./actions";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PageProps = { searchParams: Promise<{ dan?: string }> };

/**
 * Upozorenje da pretplata ističe ili je istekla.
 *
 * Ništa se ne gasi samo — pauzu i dalje pritiska vlasnik platforme ručno.
 * Ovo postoji da mu potez ne dođe kao iznenađenje: vlasnica koja vidi datum
 * ima priliku da obnovi pre nego što joj link stane.
 */
function SubscriptionNotice({
  paidUntil,
  today,
}: {
  paidUntil: string | null;
  today: string;
}) {
  const state = subscriptionState(paidUntil, today);

  if (state === "none" || state === "active" || paidUntil === null) {
    return null;
  }

  const left = daysUntil(paidUntil, today);
  const overdue = state === "overdue";

  const title = overdue
    ? sr.dashboard.subscriptionOverdueTitle
    : left === 0
      ? sr.dashboard.subscriptionDueTodayTitle
      : sr.dashboard.subscriptionDueSoonTitle.replace(
          "{dana}",
          `${left} ${pluralize(left, sr.dashboard.daysCount)}`,
        );

  return (
    <div
      role="status"
      className={cn(
        "mb-3 rounded-[18px] p-4",
        overdue ? "bg-[#B3261E]/10" : "bg-white",
      )}
    >
      <p
        className={cn(
          "text-sm font-semibold",
          overdue && "text-[#B3261E]",
        )}
      >
        {title}
      </p>
      <p className="pt-1 text-xs leading-relaxed text-[#554C44]">
        {overdue
          ? sr.dashboard.subscriptionOverdueBody
          : sr.dashboard.subscriptionDueBody}
      </p>
    </div>
  );
}

function dayHeading(date: string): string {
  const day = Number(date.slice(8, 10));
  const month = sr.calendar.months[Number(date.slice(5, 7)) - 1];

  return `${sr.calendar.weekdaysShort[isoWeekday(date) - 1]}, ${day}. ${month}`;
}

function monthLabel(date: string): string {
  return `${sr.calendar.months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const requested = (await searchParams).dan;
  const asked = requested && DATE_PATTERN.test(requested) ? requested : null;

  // Jedan poziv umesto tri u nizu: salon, spisak salona, radno vreme i termini.
  const [week, platformOwner] = await Promise.all([
    getDashboardWeek(asked, await selectedTenantId()),
    isPlatformOwner(),
  ]);

  if (!week) {
    // Ovde se stiže sa praznim nalogom ili sa izborom koji više ne važi, pa
    // spisak salona mora da stigne posebno — kalendara nema da ga ponese.
    const mine = await getMyTenants();

    return (
      <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
        <main className="mx-auto w-full max-w-md space-y-4 p-4">
          <p className="pt-8 text-sm text-[#554C44]">{sr.dashboard.noTenant}</p>
          {mine.length > 0 ? (
            <TenantSwitcher
              tenants={mine}
              selected={mine[0]!.id}
              onSwitch={switchTenant}
            />
          ) : null}
        </main>
      </div>
    );
  }

  const { tenant, today, time_off: absences } = week;
  const selected = asked ?? today;
  // Dani se izvode iz ponedeljka koji je vratila baza, da se prikazana nedelja
  // i raspon po kom su termini birani ne mogu razići.
  const weekDates = isoWeekDates(week.week_start);

  const live = week.appointments.filter((appointment) =>
    LIVE_STATUSES.includes(appointment.status),
  );
  const cancelled = week.appointments.filter(
    (appointment) => !LIVE_STATUSES.includes(appointment.status),
  );

  function within(
    list: DashboardAppointment[],
    date: string,
  ): DashboardAppointment[] {
    const bounds = dayBoundsInTimeZone(date, tenant.timezone);

    return list.filter((appointment) => {
      const startAt = new Date(appointment.start_at);
      return startAt >= bounds.from && startAt < bounds.to;
    });
  }

  // Tačka na traci dana broji samo žive termine: otkazan termin je oslobodio
  // svoje vreme i ne sme da izgleda kao zauzet dan.
  //
  // Dan koji je odsustvo pojelo celog je neradan isto kao dan bez radnog
  // vremena. Tačka na njemu ostaje ako u njemu ipak stoji zakazan termin — siv
  // dan sa tačkom je tačno ono što se desilo: ne radim, a nešto je zakazano.
  const days: StripDay[] = weekDates.map((date) => ({
    date,
    appointments: within(live, date).length,
    working:
      week.blocks.some((block) => block.weekday === isoWeekday(date)) &&
      !dayFullyOff(absences, date, tenant.timezone),
  }));

  const selectedDay = days.find((day) => day.date === selected);
  const ofDay = within(live, selected);
  const cancelledOfDay = within(cancelled, selected);
  const absencesOfDay = timeOffOfDay(absences, selected, tenant.timezone);
  const previousWeek = addDays(week.week_start, -7);
  const nextWeek = addDays(week.week_start, 7);

  return (
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <main className="mx-auto w-full max-w-md px-4 pb-6">
        <header className="flex h-[60px] items-center justify-between gap-3">
          {week.tenants.length > 1 ? (
            <TenantSwitcher
              tenants={week.tenants}
              selected={tenant.id}
              onSwitch={switchTenant}
            />
          ) : (
            <h1
              className={`${display.className} min-w-0 truncate text-[19px] tracking-[0.01em]`}
            >
              {tenant.name}
            </h1>
          )}
          <div className="flex shrink-0 items-center gap-2">
            {platformOwner ? (
              <Link
                href="/admin"
                className="flex h-11 items-center rounded-full bg-white px-4 text-[11px] font-bold tracking-[0.12em] uppercase"
              >
                {sr.admin.open}
              </Link>
            ) : null}
            <Link
              href="/dashboard/podesavanja"
              aria-label={sr.settings.open}
              className="grid size-11 place-items-center rounded-full bg-white transition-colors hover:bg-[#E4DAC9]"
            >
              <Settings size={18} strokeWidth={1.8} aria-hidden />
            </Link>
            <form action={signOut}>
              <Button
                type="submit"
                variant="ghost"
                className="h-11 rounded-full px-4 text-[11px] font-bold tracking-[0.12em] uppercase hover:bg-white"
              >
                {sr.dashboard.signOut}
              </Button>
            </form>
          </div>
        </header>

        {tenant.suspended ? (
          <div
            role="status"
            className="mb-3 rounded-[18px] bg-[#B3261E]/10 p-4"
          >
            <p className="text-sm font-semibold text-[#B3261E]">
              {sr.dashboard.suspendedTitle}
            </p>
            <p className="pt-1 text-xs leading-relaxed text-[#554C44]">
              {sr.dashboard.suspendedBody}
            </p>
          </div>
        ) : (
          /* Pauziran salon već ima svoju traku — dve jedna iznad druge bi samo
             gurnule kalendar niže. Salon bez datuma ne vidi ništa. */
          <SubscriptionNotice paidUntil={tenant.paid_until} today={today} />
        )}

        <nav className="flex items-center justify-between gap-2 pb-2">
          <span className="pl-1 text-[13px] text-[#554C44]">
            {monthLabel(selected)}
          </span>
          <span className="flex items-center gap-1">
            <Link
              href={`/dashboard?dan=${previousWeek}`}
              aria-label={sr.dashboard.previousWeek}
              className="grid size-11 place-items-center rounded-full text-[#554C44] transition-colors hover:bg-white"
            >
              <ChevronLeft size={18} strokeWidth={2} aria-hidden />
            </Link>
            <Link
              href={`/dashboard?dan=${today}`}
              className="flex h-11 items-center rounded-full px-3 text-[11px] font-bold tracking-[0.12em] uppercase transition-colors hover:bg-white"
            >
              {sr.dashboard.today}
            </Link>
            <Link
              href={`/dashboard?dan=${nextWeek}`}
              aria-label={sr.dashboard.nextWeek}
              className="grid size-11 place-items-center rounded-full text-[#554C44] transition-colors hover:bg-white"
            >
              <ChevronRight size={18} strokeWidth={2} aria-hidden />
            </Link>
          </span>
        </nav>

        {/* Traka ide bliže ivici ekrana od ostatka strane: sedam polja mora da
            ostane široko najmanje 44px i na telefonu od 360px. */}
        <div className="-mx-1.5">
          <WeekStrip days={days} selected={selected} today={today} />
        </div>

        <section className="pt-5">
          <div className="flex items-baseline justify-between gap-3 pb-3">
            <h2 className={`${display.className} text-[22px]`}>
              {dayHeading(selected)}
            </h2>
            {ofDay.length > 0 ? (
              <span className="shrink-0 text-[11.5px] text-[#6B6055]">
                {`${ofDay.length} ${pluralize(ofDay.length, sr.dashboard.appointmentsCount)}`}
              </span>
            ) : null}
          </div>

          {ofDay.length > 0 ||
          cancelledOfDay.length > 0 ||
          absencesOfDay.length > 0 ? (
            <DayList
              appointments={ofDay}
              cancelled={cancelledOfDay}
              timeOff={absencesOfDay}
              timeZone={tenant.timezone}
            />
          ) : (
            <p className="rounded-[18px] border border-dashed border-[#DED5C7] px-4 py-7 text-center text-[13px] text-[#6B6055]">
              {selectedDay?.working
                ? sr.dashboard.emptyDay
                : sr.dashboard.notWorking}
            </p>
          )}
        </section>

        <Link
          href={`/dashboard/termin/novi?dan=${selected}`}
          className="mt-5 flex h-14 items-center justify-center gap-2.5 rounded-full bg-[#211D1A] text-[13.5px] font-semibold text-[#FBF7F0] transition-colors hover:bg-[#3A332E]"
        >
          <Plus size={17} strokeWidth={2} aria-hidden />
          {sr.dashboard.addAppointment}
        </Link>
      </main>
    </div>
  );
}
