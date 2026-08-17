"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { blockNumber, unblockNumber } from "@/lib/db/blocklist";
import { getCurrentTenant, updateBookingSettings } from "@/lib/db/tenants";
import { removeService, saveService } from "@/lib/db/services";
import { addTimeOff, removeTimeOff } from "@/lib/db/time-off";
import { setWorkingBlocks } from "@/lib/db/working-hours";
import { addDays, instantInTimeZone, timeToMinutes } from "@/lib/domain/calendar";
import { normalizePhone } from "@/lib/domain/phone";
import { toBlocks, validateDay, type DayShape } from "@/lib/domain/working-hours";
import { sr } from "@/lib/i18n/sr";

export type SettingsState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string };

/** Biraju se iz spiska, pa polje već nosi minute od ponoći. */
function minutes(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 24 * 60
    ? parsed
    : null;
}

function readWeek(formData: FormData): DayShape[] | null {
  const days: DayShape[] = [];

  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const working = formData.get(`working-${weekday}`) === "on";
    const start = minutes(formData.get(`start-${weekday}`));
    const end = minutes(formData.get(`end-${weekday}`));
    const breakStart = minutes(formData.get(`break-start-${weekday}`));
    const breakEnd = minutes(formData.get(`break-end-${weekday}`));
    const slot = Number(formData.get(`slot-${weekday}`));

    if (working && (start === null || end === null || !Number.isFinite(slot))) {
      return null;
    }

    days.push({
      weekday,
      working,
      startMinute: start ?? 9 * 60,
      endMinute: end ?? 17 * 60,
      breakStartMinute: breakStart,
      breakEndMinute: breakEnd,
      slotMinutes: Number.isFinite(slot) && slot > 0 ? slot : 60,
    });
  }

  return days;
}

export async function saveWorkingHours(
  formData: FormData,
): Promise<SettingsState> {
  const week = readWeek(formData);

  if (!week) {
    return { status: "error", message: sr.settings.hoursProblem.invalid };
  }

  for (const day of week) {
    const problem = validateDay(day);
    if (problem) {
      return { status: "error", message: sr.settings.hoursProblem[problem] };
    }
  }

  const result = await setWorkingBlocks(toBlocks(week));

  if (!result.ok) {
    const known = sr.settings.hoursProblem;
    return {
      status: "error",
      message:
        result.reason in known
          ? known[result.reason as keyof typeof known]
          : sr.settings.failed,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/podesavanja");
  return { status: "saved" };
}

const rulesSchema = z.object({
  horizonDays: z.coerce.number().int().min(1).max(90),
  leadHours: z.coerce.number().int().min(0).max(168),
  publicEnabled: z.boolean(),
});

export async function saveBookingRules(
  formData: FormData,
): Promise<SettingsState> {
  const parsed = rulesSchema.safeParse({
    horizonDays: formData.get("horizonDays"),
    leadHours: formData.get("leadHours"),
    publicEnabled: formData.get("publicEnabled") === "on",
  });

  if (!parsed.success) {
    return { status: "error", message: sr.settings.failed };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { status: "error", message: sr.dashboard.noTenant };
  }

  await updateBookingSettings({
    tenantId: tenant.id,
    horizonDays: parsed.data.horizonDays,
    minLeadMinutes: parsed.data.leadHours * 60,
    publicBookingEnabled: parsed.data.publicEnabled,
  });

  revalidatePath("/dashboard/podesavanja");
  return { status: "saved" };
}

export async function addBlockedNumber(
  formData: FormData,
): Promise<SettingsState> {
  const phone = normalizePhone(String(formData.get("phone") ?? ""));

  if (!phone.ok) {
    return { status: "error", message: sr.booking.phoneProblem[phone.reason] };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { status: "error", message: sr.dashboard.noTenant };
  }

  const reason = String(formData.get("reason") ?? "").trim();

  await blockNumber({
    tenantId: tenant.id,
    phoneE164: phone.e164,
    reason: reason === "" ? null : reason,
  });

  revalidatePath("/dashboard/podesavanja");
  return { status: "saved" };
}

const timeOffSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  toTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  reason: z.string(),
});

function optionalTime(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export async function saveTimeOff(formData: FormData): Promise<SettingsState> {
  const parsed = timeOffSchema.safeParse({
    fromDate: formData.get("fromDate"),
    toDate: formData.get("toDate"),
    fromTime: optionalTime(formData.get("fromTime")),
    toTime: optionalTime(formData.get("toTime")),
    reason: String(formData.get("reason") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: sr.settings.failed };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { status: "error", message: sr.dashboard.noTenant };
  }

  // Bez unetog vremena odsustvo pokriva cele dane, od ponoći prvog do ponoći
  // posle poslednjeg — zato kraj ide na sledeći dan u 00:00.
  const startAt = instantInTimeZone(
    parsed.data.fromDate,
    parsed.data.fromTime === null ? 0 : timeToMinutes(parsed.data.fromTime),
    tenant.timezone,
  );
  const endAt =
    parsed.data.toTime === null
      ? instantInTimeZone(addDays(parsed.data.toDate, 1), 0, tenant.timezone)
      : instantInTimeZone(
          parsed.data.toDate,
          timeToMinutes(parsed.data.toTime),
          tenant.timezone,
        );

  const reason = parsed.data.reason.trim();
  const result = await addTimeOff({
    startAt,
    endAt,
    reason: reason === "" ? null : reason,
  });

  if (!result.ok) {
    const known = sr.settings.timeOffProblem;
    return {
      status: "error",
      message:
        result.reason in known
          ? known[result.reason as keyof typeof known]
          : sr.settings.failed,
    };
  }

  revalidatePath("/dashboard/podesavanja");
  return { status: "saved" };
}

export async function deleteTimeOff(id: string): Promise<SettingsState> {
  const parsed = z.uuid().safeParse(id);

  if (!parsed.success) {
    return { status: "error", message: sr.settings.failed };
  }

  await removeTimeOff(parsed.data);

  revalidatePath("/dashboard/podesavanja");
  return { status: "saved" };
}

export async function removeBlockedNumber(id: string): Promise<SettingsState> {
  const parsed = z.uuid().safeParse(id);

  if (!parsed.success) {
    return { status: "error", message: sr.settings.failed };
  }

  await unblockNumber(parsed.data);

  revalidatePath("/dashboard/podesavanja");
  return { status: "saved" };
}

const serviceSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  name: z.string(),
  durationMin: z.coerce.number().int().min(1).max(1440),
  priceRsd: z.coerce.number().int().min(0).max(10_000_000),
});

export async function saveServiceEntry(
  formData: FormData,
): Promise<SettingsState> {
  const parsed = serviceSchema.safeParse({
    id: formData.get("id") ?? "",
    name: formData.get("name"),
    durationMin: formData.get("durationMin"),
    priceRsd: formData.get("priceRsd"),
  });

  if (!parsed.success) {
    return { status: "error", message: sr.settings.failed };
  }

  const result = await saveService({
    id: parsed.data.id === "" ? null : parsed.data.id,
    name: parsed.data.name,
    durationMin: parsed.data.durationMin,
    priceRsd: parsed.data.priceRsd,
  });

  if (!result.ok) {
    const known = sr.settings.serviceProblem;
    return {
      status: "error",
      message:
        result.reason in known
          ? known[result.reason as keyof typeof known]
          : sr.settings.failed,
    };
  }

  revalidatePath("/dashboard/podesavanja");
  revalidatePath("/dashboard/termin/novi");
  return { status: "saved" };
}

export async function deleteServiceEntry(id: string): Promise<SettingsState> {
  const parsed = z.uuid().safeParse(id);

  if (!parsed.success) {
    return { status: "error", message: sr.settings.failed };
  }

  const result = await removeService(parsed.data);

  if (!result.ok) {
    return { status: "error", message: sr.settings.failed };
  }

  revalidatePath("/dashboard/podesavanja");
  revalidatePath("/dashboard/termin/novi");
  return { status: "saved" };
}
