"use server";

import { formatInTimeZone } from "date-fns-tz";
import { after } from "next/server";
import { z } from "zod";
import {
  cancelPublicAppointment,
  getAppointmentsForPhone,
  type UpcomingAppointment,
} from "@/lib/db/public-cancel";
import { existingDeviceId } from "@/lib/device";
import { dashboardLink } from "@/lib/domain/dashboard-link";
import { normalizePhone } from "@/lib/domain/phone";
import { sr } from "@/lib/i18n/sr";
import { notifyTenant } from "@/lib/messaging/push";
import { networkHash } from "@/lib/network";

export type LookupState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "found"; phone: string; appointments: UpcomingAppointment[] };

const lookupSchema = z.object({
  slug: z.string().min(1),
  phone: z.string(),
});

export async function lookupAppointments(
  formData: FormData,
): Promise<LookupState> {
  const parsed = lookupSchema.safeParse({
    slug: formData.get("slug"),
    phone: formData.get("phone"),
  });

  if (!parsed.success) {
    return { status: "error", message: sr.cancel.failed };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone.ok) {
    return { status: "error", message: sr.booking.phoneProblem[phone.reason] };
  }

  const slug = parsed.data.slug;
  const appointments = await getAppointmentsForPhone({
    slug,
    phoneE164: phone.e164,
  });

  if (appointments === null) {
    return { status: "error", message: sr.booking.closed };
  }

  return { status: "found", phone: phone.e164, appointments };
}

export type CancelState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "cancelled" };

function rejectionMessage(reason: string): string {
  const known = sr.cancel.rejected;

  return reason in known
    ? known[reason as keyof typeof known]
    : sr.cancel.failed;
}

const cancelSchema = z.object({
  slug: z.string().min(1),
  phone: z.string(),
  appointmentId: z.uuid(),
});

export async function cancelAppointment(
  formData: FormData,
): Promise<CancelState> {
  const parsed = cancelSchema.safeParse({
    slug: formData.get("slug"),
    phone: formData.get("phone"),
    appointmentId: formData.get("appointmentId"),
  });

  if (!parsed.success) {
    return { status: "error", message: sr.cancel.failed };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone.ok) {
    return { status: "error", message: sr.booking.phoneProblem[phone.reason] };
  }

  const result = await cancelPublicAppointment({
    slug: parsed.data.slug,
    phoneE164: phone.e164,
    appointmentId: parsed.data.appointmentId,
    deviceId: await existingDeviceId(),
    networkHash: await networkHash(parsed.data.slug),
  });

  // Ponovljen zahtev (odgovor se izgubio, ili dva dodira) na termin koji je već
  // otkazan: klijentkinja je dobila ono što traži, pa je to uspeh. Salon se
  // ne obaveštava drugi put.
  if (!result.ok && result.reason === "already_cancelled") {
    return { status: "cancelled" };
  }

  if (!result.ok) {
    return { status: "error", message: rejectionMessage(result.reason) };
  }

  // Posle odgovora, ne pre njega: klijentkinja ne čeka na tuđi telefon, isto
  // kao kod zakazivanja.
  const cancelled = result.appointment;
  after(async () => {
    await notifyTenant({
      tenantId: cancelled.tenant_id,
      appointmentId: cancelled.id,
      template: "client_cancelled",
      payload: {
        title: sr.push.clientCancelledTitle,
        body: sr.push.clientCancelledBody
          .replace("{klijent}", cancelled.client_name)
          .replace("{usluga}", cancelled.service_name)
          .replace(
            "{vreme}",
            formatInTimeZone(
              new Date(cancelled.start_at),
              cancelled.timezone,
              "dd.MM. 'u' HH:mm",
            ),
          ),
        url: dashboardLink({
          tenantId: cancelled.tenant_id,
          day: formatInTimeZone(
            new Date(cancelled.start_at),
            cancelled.timezone,
            "yyyy-MM-dd",
          ),
        }),
        tag: `otkazano:${cancelled.id}`,
      },
    });
  });

  return { status: "cancelled" };
}
