"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { blockNumber, unblockNumber } from "@/lib/db/blocklist";
import { getCurrentTenant } from "@/lib/db/tenants";
import { updateBookingSettings } from "@/lib/db/tenants";
import { setWorkingHours } from "@/lib/db/working-hours";
import { normalizePhone } from "@/lib/domain/phone";
import { toIntervals, validateDay, type DayShape } from "@/lib/domain/working-hours";
import { sr } from "@/lib/i18n/sr";

export type SettingsState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string };

const MINUTE_PATTERN = /^\d{2}:\d{2}$/;

function minutes(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !MINUTE_PATTERN.test(value)) {
    return null;
  }
  const [hours, rest] = value.split(":");
  return Number(hours) * 60 + Number(rest);
}

function readWeek(formData: FormData): DayShape[] | null {
  const days: DayShape[] = [];

  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const working = formData.get(`working-${weekday}`) === "on";
    const start = minutes(formData.get(`start-${weekday}`));
    const end = minutes(formData.get(`end-${weekday}`));
    const breakStart = minutes(formData.get(`break-start-${weekday}`));
    const breakEnd = minutes(formData.get(`break-end-${weekday}`));

    if (working && (start === null || end === null)) {
      return null;
    }

    days.push({
      weekday,
      working,
      startMinute: start ?? 9 * 60,
      endMinute: end ?? 17 * 60,
      breakStartMinute: breakStart,
      breakEndMinute: breakEnd,
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

  const result = await setWorkingHours(toIntervals(week));

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

export async function removeBlockedNumber(id: string): Promise<SettingsState> {
  const parsed = z.uuid().safeParse(id);

  if (!parsed.success) {
    return { status: "error", message: sr.settings.failed };
  }

  await unblockNumber(parsed.data);

  revalidatePath("/dashboard/podesavanja");
  return { status: "saved" };
}
