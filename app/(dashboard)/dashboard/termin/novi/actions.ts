"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { createAppointment } from "@/lib/db/appointments";
import { checkServiceWindow } from "@/lib/db/services";
import { getCurrentTenant } from "@/lib/db/tenants";
import { deviceId } from "@/lib/device";
import { instantInTimeZone, timeToMinutes } from "@/lib/domain/calendar";
import { normalizePhone } from "@/lib/domain/phone";
import { sr } from "@/lib/i18n/sr";
import { selectedTenantId } from "@/lib/tenant";

const formSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  serviceId: z.uuid(),
  durationMin: z.coerce.number().int().min(5).max(1440),
  name: z.string(),
  phone: z.string(),
});

export type NewAppointmentState =
  | { status: "idle" }
  | { status: "error"; message: string }
  /** Pravilo usluge kaže da ne ide, ali odluka je vlasničina. */
  | { status: "warning"; message: string };

function rejectionMessage(reason: string): string {
  const known = sr.newAppointment.rejected;

  return reason in known
    ? known[reason as keyof typeof known]
    : sr.newAppointment.failed;
}

export async function saveAppointment(
  formData: FormData,
): Promise<NewAppointmentState> {
  const parsed = formSchema.safeParse({
    date: formData.get("date"),
    time: formData.get("time"),
    serviceId: formData.get("serviceId"),
    durationMin: formData.get("durationMin"),
    name: formData.get("name"),
    phone: formData.get("phone"),
  });

  if (!parsed.success) {
    return { status: "error", message: sr.newAppointment.failed };
  }

  const name = parsed.data.name.trim();
  if (name === "") {
    return {
      status: "error",
      message: sr.newAppointment.rejected.invalid_name,
    };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone.ok) {
    return { status: "error", message: sr.booking.phoneProblem[phone.reason] };
  }

  const tenant = await getCurrentTenant(await selectedTenantId());
  if (!tenant) {
    return { status: "error", message: sr.dashboard.noTenant };
  }

  const startAt = instantInTimeZone(
    parsed.data.date,
    timeToMinutes(parsed.data.time),
    tenant.timezone,
  );

  // Klijentkinji sajt ovo ne dozvoljava; vlasnici samo kaže, jer ona zna ko
  // joj dolazi i šta će raditi. Drugi pritisak na „Sačuvaj svejedno" prolazi.
  if (formData.get("ignoreWindow") !== "1") {
    const problem = await checkServiceWindow({
      serviceId: parsed.data.serviceId,
      phoneE164: phone.e164,
      tenantId: tenant.id,
      startAt,
    });

    if (problem) {
      return {
        status: "warning",
        message: sr.newAppointment.serviceWindowWarning
          .replace(
            "{datum}",
            formatInTimeZone(new Date(problem.last_visit), tenant.timezone, "dd.MM.yyyy."),
          )
          .replace("{dana}", String(problem.window_days))
          .replace("{usluga}", problem.required_service_name),
      };
    }
  }

  const result = await createAppointment({
    serviceId: parsed.data.serviceId,
    durationMin: parsed.data.durationMin,
    startAt,
    clientName: name,
    phoneE164: phone.e164,
    deviceId: await deviceId(),
  });

  if (!result.ok) {
    return { status: "error", message: rejectionMessage(result.reason) };
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?dan=${parsed.data.date}`);
}
