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
 *
 * Razmak je 4px, a traka ide bliže ivici ekrana od ostatka strane: na 360px
 * širine sedam polja sa razmakom od 6px daje 41px po polju, ispod mete koju
 * prst pouzdano pogađa.
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
                "flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-2xl border transition-colors",
                isSelected
                  ? "border-[#8C1D3F] bg-[#8C1D3F] text-[#FBF7F0]"
                  : day.working
                    ? "border-[#E4DAC9] bg-white text-[#211D1A]"
                    : "border-[#E4DAC9]/60 bg-white/50 text-[#6B6055]",
              )}
            >
              <span className="text-[9.5px] font-bold tracking-[0.1em] uppercase">
                {sr.calendar.weekdaysShort[isoWeekday(day.date) - 1]}
              </span>
              <span
                className={cn(
                  "text-base leading-none font-semibold tabular-nums",
                  day.date === today &&
                    !isSelected &&
                    "underline decoration-[#8C1D3F] decoration-2 underline-offset-[3px]",
                )}
              >
                {Number(day.date.slice(8, 10))}
              </span>
              <span
                aria-hidden
                className={cn(
                  "size-1 rounded-full",
                  day.appointments > 0
                    ? isSelected
                      ? "bg-[#FBF7F0]"
                      : "bg-[#8C1D3F]"
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
