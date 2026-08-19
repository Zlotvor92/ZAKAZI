import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const staffSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
});

export type Staff = z.infer<typeof staffSchema>;

/** Izvođači salona, aktivni prvi. Nečlanu RLS ne pokaže nijedan red. */
export async function getStaff(tenantId: string | null): Promise<Staff[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("tenant_staff", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`Čitanje izvođača nije uspelo: ${error.message}`);
  }

  return z.array(staffSchema).parse(data ?? []);
}

const writeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), id: z.uuid().optional() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type StaffWriteResult = z.infer<typeof writeResultSchema>;

/** Bez `staffId` dodaje novog; sa njim menja ime postojećem. */
export async function saveStaff(input: {
  tenantId: string;
  staffId: string | null;
  name: string;
}): Promise<StaffWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_staff", {
    p_name: input.name,
    p_staff_id: input.staffId,
    p_tenant_id: input.tenantId,
  });

  if (error) {
    throw new Error(`Upis izvođača nije uspeo: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}

/** Ne briše red — termini pokazuju na njega. Samo ga skida sa spiska. */
export async function removeStaff(input: {
  tenantId: string;
  staffId: string;
}): Promise<StaffWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("deactivate_staff", {
    p_staff_id: input.staffId,
    p_tenant_id: input.tenantId,
  });

  if (error) {
    throw new Error(`Sklanjanje izvođača nije uspelo: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}
