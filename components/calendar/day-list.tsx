import { formatInTimeZone } from "date-fns-tz";
import type { DashboardAppointment } from "@/lib/db/appointments";
import { sr } from "@/lib/i18n/sr";
import { cn } from "@/lib/utils";

/** Statusi koji su završena priča i zato izbledeli u spisku. */
const SETTLED = new Set(["completed", "no_show"]);

export function DayList({
  appointments,
  timeZone,
}: {
  appointments: DashboardAppointment[];
  timeZone: string;
}) {
  return (
    <ul className="divide-border divide-y">
      {appointments.map((appointment) => (
        <li
          key={appointment.id}
          className={cn(
            "flex items-start gap-3 py-3",
            SETTLED.has(appointment.status) && "opacity-60",
          )}
        >
          <div className="w-12 shrink-0 text-sm tabular-nums">
            <div className="font-medium">
              {formatInTimeZone(new Date(appointment.start_at), timeZone, "HH:mm")}
            </div>
            <div className="text-muted-foreground text-xs">
              {formatInTimeZone(new Date(appointment.end_at), timeZone, "HH:mm")}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {appointment.client_name}
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {appointment.service_name}
              {appointment.source === "public"
                ? ` · ${sr.dashboard.fromPublicPage}`
                : ""}
            </div>
          </div>

          <div className="text-muted-foreground shrink-0 text-right text-xs">
            {sr.appointmentStatus[appointment.status]}
          </div>
        </li>
      ))}
    </ul>
  );
}
