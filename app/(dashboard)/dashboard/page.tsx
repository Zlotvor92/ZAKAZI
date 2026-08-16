import { WeekGridView } from "@/components/calendar/week-grid";
import { Button } from "@/components/ui/button";
import { getWorkingHours } from "@/lib/db/working-hours";
import { getCurrentTenant } from "@/lib/db/tenants";
import {
  buildWeekGrid,
  currentDateInTimeZone,
  startOfIsoWeek,
} from "@/lib/domain/calendar";
import { sr } from "@/lib/i18n/sr";
import { signOut } from "./actions";

function weekLabel(weekStart: string, weekEnd: string): string {
  const startDay = Number(weekStart.slice(8, 10));
  const endDay = Number(weekEnd.slice(8, 10));
  const startMonth = sr.calendar.months[Number(weekStart.slice(5, 7)) - 1];
  const endMonth = sr.calendar.months[Number(weekEnd.slice(5, 7)) - 1];
  const year = weekEnd.slice(0, 4);

  if (startMonth === endMonth) {
    return `${startDay}–${endDay}. ${endMonth} ${year}.`;
  }

  return `${startDay}. ${startMonth} – ${endDay}. ${endMonth} ${year}.`;
}

export default async function DashboardPage() {
  const tenant = await getCurrentTenant();

  if (!tenant) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-3xl p-4">
        <p className="text-muted-foreground py-8 text-sm">
          {sr.dashboard.noTenant}
        </p>
      </main>
    );
  }

  const workingHours = await getWorkingHours();
  const today = currentDateInTimeZone(new Date(), tenant.timezone);
  const grid = buildWeekGrid({
    weekStart: startOfIsoWeek(today),
    workingHours,
  });

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl p-4">
      <header className="flex items-center justify-between gap-4 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {tenant.name}
          </h1>
          <p className="text-muted-foreground text-xs">
            {weekLabel(grid.days[0]!.date, grid.days[6]!.date)}
          </p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            {sr.dashboard.signOut}
          </Button>
        </form>
      </header>

      {workingHours.length === 0 ? (
        <p className="text-muted-foreground py-4 text-sm">
          {sr.calendar.noWorkingHours}
        </p>
      ) : null}

      <WeekGridView grid={grid} today={today} />
    </main>
  );
}
