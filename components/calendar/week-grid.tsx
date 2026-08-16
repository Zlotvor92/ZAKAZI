import { minutesToTime, type WeekGrid } from "@/lib/domain/calendar";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";

/** Visina jednog sata. Ceo dan salona staje na ekran telefona bez zumiranja. */
const HOUR_HEIGHT_REM = 3;

function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}

export function WeekGridView({
  grid,
  today,
}: {
  grid: WeekGrid;
  today: string;
}) {
  const totalMinutes = grid.endMinute - grid.startMinute;
  const bodyHeight = `${(totalMinutes / 60) * HOUR_HEIGHT_REM}rem`;

  function offsetRem(minute: number): string {
    return `${((minute - grid.startMinute) / 60) * HOUR_HEIGHT_REM}rem`;
  }

  return (
    <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]">
      <div aria-hidden />
      {grid.days.map((day) => (
        <div
          key={day.date}
          className={cn(
            "border-border border-b pb-1 text-center",
            day.date === today && "text-foreground font-semibold",
            day.date !== today && "text-muted-foreground",
          )}
        >
          <div className="text-[0.6875rem] leading-tight">
            {sr.calendar.weekdaysShort[day.weekday - 1]}
          </div>
          <div className="text-sm leading-tight tabular-nums">
            {dayNumber(day.date)}
          </div>
        </div>
      ))}

      <div className="relative" style={{ height: bodyHeight }}>
        {grid.hourMarks.slice(0, -1).map((minute) => (
          <div
            key={minute}
            className="text-muted-foreground absolute right-1 -translate-y-1/2 text-[0.625rem] tabular-nums"
            style={{ top: offsetRem(minute) }}
          >
            {minutesToTime(minute)}
          </div>
        ))}
      </div>

      {grid.days.map((day) => (
        <div
          key={day.date}
          className="border-border relative border-l"
          style={{ height: bodyHeight }}
        >
          {grid.hourMarks.map((minute) => (
            <div
              key={minute}
              aria-hidden
              className="border-border/60 absolute inset-x-0 border-t"
              style={{ top: offsetRem(minute) }}
            />
          ))}

          {day.intervals.map((interval) => (
            <div
              key={interval.startMinute}
              className="bg-accent absolute inset-x-0.5 rounded-sm"
              style={{
                top: offsetRem(interval.startMinute),
                height: `${((interval.endMinute - interval.startMinute) / 60) * HOUR_HEIGHT_REM}rem`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
