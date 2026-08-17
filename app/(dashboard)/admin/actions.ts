"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSalon, setSalonSuspended } from "@/lib/db/admin";
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
