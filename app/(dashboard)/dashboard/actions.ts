"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  blockClientOfAppointment,
  setAppointmentStatus,
} from "@/lib/db/appointments";
import { deviceId } from "@/lib/device";
import { sr } from "@/lib/i18n/sr";
import { createClient } from "@/lib/supabase/server";

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/prijava");
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
