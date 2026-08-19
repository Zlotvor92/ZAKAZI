"use server";

import { formatInTimeZone } from "date-fns-tz";
import { after } from "next/server";
import { z } from "zod";
import { bookPublicAppointment } from "@/lib/db/public-booking";
import { deviceId } from "@/lib/device";
import { normalizePhone } from "@/lib/domain/phone";
import { sr } from "@/lib/i18n/sr";
import { notifyTenant } from "@/lib/messaging/push";
import { networkHash } from "@/lib/network";

const bookingSchema = z.object({
  slug: z.string().min(1),
  serviceId: z.uuid(),
  // Prazno polje znači „svejedno mi je"; bazi ostaje da nađe ko je slobodan.
  staffId: z.union([z.uuid(), z.literal("")]).optional(),
  startAt: z.iso.datetime({ offset: true }),
  name: z.string(),
  phone: z.string(),
});

export type BookingState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "booked";
      appointment: {
        startAt: string;
        endAt: string;
        serviceName: string;
        priceRsd: number;
      };
    };

function rejectionMessage(reason: string): string {
  const known = sr.booking.rejected;

  return reason in known
    ? known[reason as keyof typeof known]
    : sr.booking.failed;
}

export async function submitBooking(
  formData: FormData,
): Promise<BookingState> {
  const parsed = bookingSchema.safeParse({
    slug: formData.get("slug"),
    serviceId: formData.get("serviceId"),
    staffId: formData.get("staffId") ?? undefined,
    startAt: formData.get("startAt"),
    name: formData.get("name"),
    phone: formData.get("phone"),
  });

  if (!parsed.success) {
    return { status: "error", message: sr.booking.failed };
  }

  const name = parsed.data.name.trim();
  if (name === "") {
    return { status: "error", message: sr.booking.rejected.invalid_name };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone.ok) {
    return { status: "error", message: sr.booking.phoneProblem[phone.reason] };
  }

  const result = await bookPublicAppointment({
    slug: parsed.data.slug,
    serviceId: parsed.data.serviceId,
    staffId: parsed.data.staffId ? parsed.data.staffId : null,
    startAt: parsed.data.startAt,
    clientName: name,
    phoneE164: phone.e164,
    deviceId: await deviceId(),
    networkHash: await networkHash(parsed.data.slug),
  });

  if (!result.ok) {
    return { status: "error", message: rejectionMessage(result.reason) };
  }

  // Posle odgovora, ne pre njega: klijentkinja ne treba da čeka na tuđi
  // telefon, a termin je već u bazi pa slanje ništa ne može da pokvari.
  const booked = result.appointment;
  const timeZone = booked.timezone;
  after(async () => {
    await notifyTenant({
      tenantId: booked.tenant_id,
      appointmentId: booked.id,
      template: "new_booking",
      payload: {
        title: sr.push.newBookingTitle,
        body: sr.push.newBookingBody
          .replace("{klijent}", name)
          .replace("{usluga}", booked.service_name)
          .replace(
            "{vreme}",
            formatInTimeZone(
              new Date(booked.start_at),
              timeZone,
              "dd.MM. 'u' HH:mm",
            ),
          ),
        url: `/dashboard?dan=${formatInTimeZone(new Date(booked.start_at), timeZone, "yyyy-MM-dd")}`,
      },
    });
  });

  return {
    status: "booked",
    appointment: {
      startAt: result.appointment.start_at,
      endAt: result.appointment.end_at,
      serviceName: result.appointment.service_name,
      priceRsd: result.appointment.price_rsd,
    },
  };
}
