"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { blockNumber, unblockNumber } from "@/lib/db/blocklist";
import {
  pushSubscriptionSchema,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/db/push";
import {
  getCurrentTenant,
  setTenantBrand,
  updateBookingSettings,
} from "@/lib/db/tenants";
import { removeService, saveService } from "@/lib/db/services";
import { addTimeOff, removeTimeOff } from "@/lib/db/time-off";
import { setWorkingBlocks } from "@/lib/db/working-hours";
import { selectedTenantId } from "@/lib/tenant";
import { addDays, instantInTimeZone, timeToMinutes } from "@/lib/domain/calendar";
import { normalizePhone } from "@/lib/domain/phone";
import { toBlocks, validateDay, type DayShape } from "@/lib/domain/working-hours";
import { sr } from "@/lib/i18n/sr";
import { createClient } from "@/lib/supabase/server";

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

  const result = await setWorkingBlocks(toBlocks(week), await selectedTenantId());

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

  const tenant = await getCurrentTenant(await selectedTenantId());
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

/** Prazno polje znači „vrati na podrazumevano", ne „nije popunjeno". */
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable();

const brandSchema = z.object({
  background: colorSchema,
  primary: colorSchema,
  accent: colorSchema,
});

function color(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export async function saveBrand(formData: FormData): Promise<SettingsState> {
  // Prekidač „koristi svoje boje": kad je ugašen, sve tri se brišu odjednom.
  const useOwn = formData.get("useOwnColors") === "on";

  const parsed = brandSchema.safeParse({
    background: useOwn ? color(formData.get("background")) : null,
    primary: useOwn ? color(formData.get("primary")) : null,
    accent: useOwn ? color(formData.get("accent")) : null,
  });

  if (!parsed.success) {
    return { status: "error", message: sr.settings.brandInvalid };
  }

  const tenant = await getCurrentTenant(await selectedTenantId());
  if (!tenant) {
    return { status: "error", message: sr.dashboard.noTenant };
  }

  const result = await setTenantBrand({
    tenantId: tenant.id,
    background: parsed.data.background,
    primary: parsed.data.primary,
    accent: parsed.data.accent,
  });

  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "incomplete"
          ? sr.settings.brandIncomplete
          : sr.settings.failed,
    };
  }

  revalidatePath("/dashboard/podesavanja");
  // Javna strana nosi boje, pa i ona mora da se osveži.
  revalidatePath(`/${tenant.slug}`);
  return { status: "saved" };
}

/**
 * Uređaj počinje da prima obaveštenja o zakazivanju.
 *
 * Pretplata dolazi iz pregledača, pa prolazi kroz Zod pre nego što išta dodirne
 * bazu. Vraća `false` umesto poruke, jer korisniku ovde ne treba objašnjenje
 * nego dugme koje se ili prevrne ili ne.
 */
export async function enableNotifications(
  subscription: unknown,
): Promise<boolean> {
  const parsed = pushSubscriptionSchema.safeParse(subscription);
  if (!parsed.success) {
    return false;
  }

  const tenant = await getCurrentTenant(await selectedTenantId());
  if (!tenant) {
    return false;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return false;
  }

  await savePushSubscription({
    tenantId: tenant.id,
    userId: data.user.id,
    subscription: parsed.data,
  });

  revalidatePath("/dashboard/podesavanja");
  return true;
}

export async function disableNotifications(endpoint: string): Promise<void> {
  const parsed = z.url().max(1000).safeParse(endpoint);
  if (!parsed.success) {
    return;
  }

  await removePushSubscription(parsed.data);
  revalidatePath("/dashboard/podesavanja");
}

export async function addBlockedNumber(
  formData: FormData,
): Promise<SettingsState> {
  const phone = normalizePhone(String(formData.get("phone") ?? ""));

  if (!phone.ok) {
    return { status: "error", message: sr.booking.phoneProblem[phone.reason] };
  }

  const tenant = await getCurrentTenant(await selectedTenantId());
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

  const tenant = await getCurrentTenant(await selectedTenantId());
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
    tenantId: tenant.id,
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
    tenantId: await selectedTenantId(),
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
