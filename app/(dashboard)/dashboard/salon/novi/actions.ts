"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createTenant } from "@/lib/db/tenants";
import { sr } from "@/lib/i18n/sr";
import { selectTenant } from "@/lib/tenant";

export type NewTenantState = { status: "idle" } | { status: "error"; message: string };

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().min(3).max(40),
});

export async function createSalon(
  formData: FormData,
): Promise<NewTenantState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });

  if (!parsed.success) {
    return { status: "error", message: sr.tenants.problem.invalid_name };
  }

  const result = await createTenant({
    name: parsed.data.name,
    slug: parsed.data.slug.toLowerCase(),
    timezone: "Europe/Belgrade",
  });

  if (!result.ok) {
    const known = sr.tenants.problem;
    return {
      status: "error",
      message:
        result.reason in known
          ? known[result.reason as keyof typeof known]
          : sr.tenants.failed,
    };
  }

  // Ko upravo otvori salon, u njemu i nastavlja da radi.
  await selectTenant(result.id);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/podesavanja");
}
