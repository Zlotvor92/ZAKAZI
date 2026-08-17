"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  blockClientOfAppointment,
  setAppointmentStatus,
} from "@/lib/db/appointments";
import { getMyTenants } from "@/lib/db/tenants";
import { deviceId } from "@/lib/device";
import { sr } from "@/lib/i18n/sr";
import { createClient } from "@/lib/supabase/server";
import { selectTenant } from "@/lib/tenant";

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/prijava");
}

/**
 * Prebacivanje u drugi salon. Članstvo se proverava pre upisa u kolačić, da
 * pogrešna vrednost ne bi ostala da stoji i zaključala ekran na praznom.
 */
export async function switchTenant(tenantId: string): Promise<void> {
  const parsed = z.uuid().safeParse(tenantId);

  if (!parsed.success) {
    return;
  }

  const mine = await getMyTenants();

  if (!mine.some((tenant) => tenant.id === parsed.data)) {
    return;
  }

  await selectTenant(parsed.data);
  revalidatePath("/dashboard", "layout");
}

export type ActionState = { ok: true } | { ok: false; message: string };

const statusSchema = z.object({
  appointmentId: z.uuid(),
  status: z.enum([
    "pending",
    "confirmed",
    "completed",
    "no_show",
    "cancelled_by_client",
    "cancelled_by_salon",
  ]),
});

export async function changeStatus(
  appointmentId: string,
  status: string,
): Promise<ActionState> {
  const parsed = statusSchema.safeParse({ appointmentId, status });

  if (!parsed.success) {
    return { ok: false, message: sr.dashboard.actionFailed };
  }

  const result = await setAppointmentStatus({
    appointmentId: parsed.data.appointmentId,
    status: parsed.data.status,
    deviceId: await deviceId(),
  });

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "invalid_transition"
          ? sr.dashboard.invalidTransition
          : sr.dashboard.actionFailed,
    };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function blockClient(appointmentId: string): Promise<ActionState> {
  const parsed = z.uuid().safeParse(appointmentId);

  if (!parsed.success) {
    return { ok: false, message: sr.dashboard.actionFailed };
  }

  const result = await blockClientOfAppointment(parsed.data);

  if (!result.ok) {
    return { ok: false, message: sr.dashboard.actionFailed };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
