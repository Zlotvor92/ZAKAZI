"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { bookPublicAppointment } from "@/lib/db/public-booking";
import { normalizePhone } from "@/lib/domain/phone";
import { sr } from "@/lib/i18n/sr";

const DEVICE_COOKIE = "zakazi_device";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

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

/**
 * Uređaj sa kog je termin zakazan, radi istorije promena. Nasumičan broj bez
 * ijednog podatka o osobi, koji preživi zatvaranje stranice da bi se dva
 * zakazivanja sa istog telefona mogla povezati.
 */
async function deviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;

  if (existing) {
    return existing;
  }

  const fresh = randomUUID();
  jar.set(DEVICE_COOKIE, fresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DEVICE_COOKIE_MAX_AGE,
    path: "/",
  });

  return fresh;
}

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
