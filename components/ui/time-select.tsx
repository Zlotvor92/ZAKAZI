import { minutesToTime } from "@/lib/domain/calendar";
import { cn } from "@/lib/utils";

/**
 * Vreme se bira iz spiska, ne kucanjem ni točkićem. Salon ne otvara u 4:30
 * ujutru, a točkić na telefonu traži da se skroluje kroz pola dana da bi se
 * stiglo do devet.
 */
const FIRST_MINUTE = 6 * 60;
const LAST_MINUTE = 24 * 60;
const STEP_MINUTES = 30;

const CHOICES = Array.from(
  { length: (LAST_MINUTE - FIRST_MINUTE) / STEP_MINUTES + 1 },
  (_, index) => FIRST_MINUTE + index * STEP_MINUTES,
);

export function TimeSelect({
  name,
  value,
  placeholder,
  onChange,
  className,
}: {
  name: string;
  value: number | null;
  placeholder?: string;
  onChange: (value: number | null) => void;
  className?: string;
}) {
  return (
    <select
      name={name}
      value={value === null ? "" : String(value)}
      onChange={(event) =>
        onChange(event.target.value === "" ? null : Number(event.target.value))
      }
      className={cn(
        "border-input bg-background h-11 w-full rounded-md border px-2 text-sm tabular-nums",
        className,
      )}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {CHOICES.map((minute) => (
        <option key={minute} value={minute}>
          {minutesToTime(minute)}
        </option>
      ))}
    </select>
  );
}
