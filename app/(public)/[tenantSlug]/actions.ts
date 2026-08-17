"use server";

import { z } from "zod";
import { bookPublicAppointment } from "@/lib/db/public-booking";
import { deviceId } from "@/lib/device";
import { normalizePhone } from "@/lib/domain/phone";
import { sr } from "@/lib/i18n/sr";

const bookingSchema = z.object({
  slug: z.string().min(1),
  serviceId: z.uuid(),
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
    startAt: parsed.data.startAt,
    clientName: name,
    phoneE164: phone.e164,
    deviceId: await deviceId(),
  });

  if (!result.ok) {
    return { status: "error", message: rejectionMessage(result.reason) };
  }

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
