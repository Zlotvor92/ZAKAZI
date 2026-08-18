import Link from "next/link";
import { DayList } from "@/components/calendar/day-list";
import { WeekStrip, type StripDay } from "@/components/calendar/week-strip";
import { TenantSwitcher } from "@/components/dashboard/tenant-switcher";
import { Button, buttonVariants } from "@/components/ui/button";
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
        "mb-2 rounded-xl border p-3",
        overdue
          ? "border-destructive/40 bg-destructive/10"
          : "border-border bg-accent",
      )}
    >
      <p
        className={cn(
          "text-sm font-semibold",
          overdue && "text-destructive",
        )}
      >
        {title}
      </p>
      <p className="text-muted-foreground pt-1 text-xs">
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
      <main className="mx-auto min-h-dvh w-full max-w-3xl space-y-4 p-4">
        <p className="text-muted-foreground pt-8 text-sm">
          {sr.dashboard.noTenant}
        </p>
        {mine.length > 0 ? (
          <TenantSwitcher
            tenants={mine}
            selected={mine[0]!.id}
            onSwitch={switchTenant}
          />
        ) : null}
      </main>
    );
  }

  const { tenant, today } = week;
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
  const days: StripDay[] = weekDates.map((date) => ({
    date,
    appointments: within(live, date).length,
    working: week.blocks.some((block) => block.weekday === isoWeekday(date)),
  }));

  const selectedDay = days.find((day) => day.date === selected);
  const ofDay = within(live, selected);
  const cancelledOfDay = within(cancelled, selected);
  const previousWeek = addDays(week.week_start, -7);
  const nextWeek = addDays(week.week_start, 7);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl p-4">
      <header className="flex items-center justify-between gap-4 pb-3">
        {week.tenants.length > 1 ? (
          <TenantSwitcher
            tenants={week.tenants}
            selected={tenant.id}
            onSwitch={switchTenant}
          />
        ) : (
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
            {tenant.name}
          </h1>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {platformOwner ? (
            <Link
              href="/admin"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {sr.admin.open}
            </Link>
          ) : null}
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

      {tenant.suspended ? (
        <div
          role="status"
          className="border-destructive/40 bg-destructive/10 mb-2 rounded-xl border p-3"
        >
          <p className="text-destructive text-sm font-semibold">
            {sr.dashboard.suspendedTitle}
          </p>
          <p className="text-muted-foreground pt-1 text-xs">
            {sr.dashboard.suspendedBody}
          </p>
        </div>
      ) : (
        /* Pauziran salon već ima svoju traku — dve jedna iznad druge bi samo
           gurnule kalendar niže. Salon bez datuma ne vidi ništa. */
        <SubscriptionNotice paidUntil={tenant.paid_until} today={today} />
      )}

      <nav className="flex items-center justify-between gap-2 pb-2">
        <Link
          href={`/dashboard?dan=${previousWeek}`}
          aria-label={sr.dashboard.previousWeek}
          className={buttonVariants({ variant: "ghost", size: "icon" })}
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
          className={buttonVariants({ variant: "ghost", size: "icon" })}
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

        {ofDay.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">
            {selectedDay?.working
              ? sr.dashboard.emptyDay
              : sr.dashboard.notWorking}
          </p>
        ) : null}

        {/* I kad dan nema nijedan živ termin: otkazani se i dalje nude, jer
            objašnjavaju zašto je dan prazan. */}
        {ofDay.length > 0 || cancelledOfDay.length > 0 ? (
          <DayList
            appointments={ofDay}
            cancelled={cancelledOfDay}
            timeZone={tenant.timezone}
          />
        ) : null}
      </section>
    </main>
  );
}
