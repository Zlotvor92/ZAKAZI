import Link from "next/link";
import { isoWeekday } from "@/lib/domain/calendar";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";

export type StripDay = {
  date: string;
  appointments: number;
  working: boolean;
};

/**
 * Sedam dana u jednom redu. Na telefonu je ovo cela navigacija kroz kalendar:
 * nedeljna mreža sa sedam kolona na 375px daje kolone od 45px, u koje ne staje
 * nijedno ime.
 */
export function WeekStrip({
  days,
  selected,
  today,
}: {
  days: StripDay[];
  selected: string;
  today: string;
}) {
  return (
    <ul className="grid grid-cols-7 gap-1">
      {days.map((day) => {
        const isSelected = day.date === selected;

        return (
          <li key={day.date}>
            <Link
              href={`/dashboard?dan=${day.date}`}
              aria-current={isSelected ? "date" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center rounded-lg border",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent",
                !isSelected && !day.working && "text-muted-foreground",
              )}
            >
              <span className="text-[0.625rem] leading-tight">
                {sr.calendar.weekdaysShort[isoWeekday(day.date) - 1]}
              </span>
              <span
                className={cn(
                  "text-sm leading-tight tabular-nums",
                  day.date === today && "font-bold underline underline-offset-2",
                )}
              >
                {Number(day.date.slice(8, 10))}
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 h-1 w-1 rounded-full",
                  day.appointments > 0
                    ? isSelected
                      ? "bg-primary-foreground"
                      : "bg-foreground"
                    : "bg-transparent",
                )}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
