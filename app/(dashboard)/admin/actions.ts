"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createSalon,
  deleteSalon as deleteSalonRow,
  isPlatformOwner,
  setSalonLogo,
  setSalonPaidUntil,
  setSalonSuspended,
} from "@/lib/db/admin";
import { clearErrors } from "@/lib/db/errors";
import { removeLogoFiles, uploadLogo } from "@/lib/db/logo";
import { sr } from "@/lib/i18n/sr";
import { ensureUser } from "@/lib/supabase/admin";
import { switchTenant } from "../dashboard/actions";

export type AdminState = { status: "idle" } | { status: "error"; message: string };

const newSalonSchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().min(3).max(40),
  ownerEmail: z.email().max(200),
});

/**
 * Novi salon i nalog vlasnice.
 *
 * Nalog se pravi pre salona, jer baza traži postojećeg korisnika — u SQL-u se
 * `auth.users` ne dira. Ako pravljenje salona padne, ostane nalog bez salona;
 * to je bezbedno stanje, jer prijava bez salona ne vidi ništa.
 *
 * Pravo se ne proverava ovde nego u bazi: `create_tenant` odbija svakog ko ne
 * upravlja platformom, pa provera ne može da se zaobiđe ni da se zaboravi.
 */
export async function addSalon(formData: FormData): Promise<AdminState> {
  const parsed = newSalonSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    ownerEmail: formData.get("ownerEmail"),
  });

  if (!parsed.success) {
    return { status: "error", message: sr.admin.problem.invalid_email };
  }

  const email = parsed.data.ownerEmail.trim().toLowerCase();

  if (!(await ensureUser(email))) {
    return { status: "error", message: sr.admin.failed };
  }

  const result = await createSalon({
    name: parsed.data.name,
    slug: parsed.data.slug.toLowerCase(),
    ownerEmail: email,
    timezone: "Europe/Belgrade",
  });

  if (!result.ok) {
    const known = sr.admin.problem;
    return {
      status: "error",
      message:
        result.reason in known
          ? known[result.reason as keyof typeof known]
          : sr.admin.failed,
    };
  }

  revalidatePath("/admin");
  redirect("/admin");
}

/**
 * Logo salona.
 *
 * Fajl ide u skladište preko `service_role` klijenta, jer skladište ne zna za
 * prijavljenog korisnika. Zato se pravo proverava dva puta u bazi: pre slanja
 * fajla i još jednom u `set_tenant_logo`, koja upisuje adresu.
 */
export async function saveLogo(formData: FormData): Promise<AdminState> {
  const tenantId = z.uuid().safeParse(formData.get("tenantId"));

  if (!tenantId.success) {
    return { status: "error", message: sr.admin.actionFailed };
  }

  if (!(await isPlatformOwner())) {
    return { status: "error", message: sr.admin.logoProblem.not_allowed };
  }

  const file = formData.get("logo");

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: sr.admin.logoProblem.failed };
  }

  const sent = await uploadLogo({ tenantId: tenantId.data, file });

  if (!sent.ok) {
    return { status: "error", message: sr.admin.logoProblem[sent.reason] };
  }

  const saved = await setSalonLogo({
    tenantId: tenantId.data,
    logoUrl: sent.url,
  });

  if (!saved.ok) {
    const known = sr.admin.logoProblem;
    return {
      status: "error",
      message:
        saved.reason in known
          ? known[saved.reason as keyof typeof known]
          : sr.admin.actionFailed,
    };
  }

  revalidatePath("/admin");
  return { status: "idle" };
}

export async function removeLogo(tenantId: string): Promise<AdminState> {
  const parsed = z.uuid().safeParse(tenantId);

  if (!parsed.success) {
    return { status: "error", message: sr.admin.actionFailed };
  }

  const removed = await setSalonLogo({ tenantId: parsed.data, logoUrl: null });

  if (!removed.ok) {
    return { status: "error", message: sr.admin.actionFailed };
  }

  revalidatePath("/admin");
  return { status: "idle" };
}

export async function toggleSalon(
  tenantId: string,
  suspended: boolean,
): Promise<AdminState> {
  const parsed = z.uuid().safeParse(tenantId);

  if (!parsed.success) {
    return { status: "error", message: sr.admin.actionFailed };
  }

  const result = await setSalonSuspended({
    tenantId: parsed.data,
    suspended,
  });

  if (!result.ok) {
    return { status: "error", message: sr.admin.actionFailed };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard", "layout");
  return { status: "idle" };
}

/**
 * Briše salon zauvek, zajedno sa svime što mu pripada.
 *
 * Pravo i prekucanu potvrdu proverava `delete_tenant` u bazi — ovde se gleda
 * samo oblik, da se u upit ne pošalje smeće.
 */
export async function deleteSalon(
  tenantId: string,
  typedSlug: string,
): Promise<AdminState> {
  const id = z.uuid().safeParse(tenantId);
  const slug = z.string().trim().max(40).safeParse(typedSlug);

  if (!id.success || !slug.success) {
    return { status: "error", message: sr.admin.actionFailed };
  }

  const result = await deleteSalonRow({
    tenantId: id.data,
    slug: slug.data.toLowerCase(),
  });

  if (!result.ok) {
    const known = sr.admin.removeProblem;
    return {
      status: "error",
      message:
        result.reason in known
          ? known[result.reason as keyof typeof known]
          : sr.admin.actionFailed,
    };
  }

  // Slike tek pošto je baza pristala. Obrnut redosled bi na odbijenom
  // brisanju uništio logo salona koji ostaje da radi.
  await removeLogoFiles(id.data);

  revalidatePath("/admin");
  // Vlasnica je mogla biti u tom salonu; njen izbor više ne postoji.
  revalidatePath("/dashboard", "layout");
  return { status: "idle" };
}

/** Prazan datum briše evidenciju i vraća salon u stanje bez naplate. */
const paidUntilSchema = z.union([
  z.iso.date(),
  z.literal("").transform(() => null),
  z.null(),
]);

export async function savePaidUntil(
  tenantId: string,
  paidUntil: string | null,
): Promise<AdminState> {
  const id = z.uuid().safeParse(tenantId);
  const date = paidUntilSchema.safeParse(paidUntil);

  if (!id.success || !date.success) {
    return { status: "error", message: sr.admin.actionFailed };
  }

  const result = await setSalonPaidUntil({
    tenantId: id.data,
    paidUntil: date.data,
  });

  if (!result.ok) {
    return { status: "error", message: sr.admin.actionFailed };
  }

  revalidatePath("/admin");
  // Vlasnica vidi svoj datum u kalendaru, pa i on mora da se osveži.
  revalidatePath("/dashboard", "layout");
  return { status: "idle" };
}

/**
 * Prazni evidenciju grešaka.
 *
 * Pravo proverava `clear_error_events` u bazi, pa se ovde ne proverava opet.
 */
export async function clearErrorLog(): Promise<AdminState> {
  try {
    await clearErrors();
  } catch {
    return { status: "error", message: sr.admin.actionFailed };
  }

  revalidatePath("/admin");
  return { status: "idle" };
}

/**
 * Ulazak u salon: isti kolačić koji vlasnica koristi za prebacivanje.
 *
 * Nema posebnog „admin pogleda". Vlasnik platforme je član svakog salona, pa
 * vidi tačno ono što vidi vlasnica — što je i poenta, jer se podešavanja
 * popravljaju na istom ekranu na kom se i zovu.
 */
export async function enterSalon(tenantId: string): Promise<void> {
  await switchTenant(tenantId);
  redirect("/dashboard");
}
