import { createAdminClient } from "@/lib/supabase/admin";

export const LOGO_BUCKET = "logos";

/** Formati koje svaki telefon ume da napravi i svaki pregledač da prikaže. */
const ALLOWED = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

const MAX_BYTES = 2 * 1024 * 1024;

export type LogoUploadResult =
  | { ok: true; url: string }
  | { ok: false; reason: "too_big" | "wrong_type" | "failed" };

/**
 * Šalje logo u skladište i vraća javnu adresu.
 *
 * Ime fajla nosi trenutak slanja, pa nova slika dobija novu adresu. Bez toga
 * bi keš pregledača i Instagrama danima vraćao stari logo, a to je greška koju
 * niko ne ume da prijavi jer „meni radi".
 */
export async function uploadLogo(input: {
  tenantId: string;
  file: File;
}): Promise<LogoUploadResult> {
  const extension = ALLOWED.get(input.file.type);

  if (!extension) {
    return { ok: false, reason: "wrong_type" };
  }

  if (input.file.size > MAX_BYTES) {
    return { ok: false, reason: "too_big" };
  }

  const supabase = createAdminClient();
  const path = `${input.tenantId}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, input.file, {
      contentType: input.file.type,
      cacheControl: "31536000",
    });

  if (error) {
    return { ok: false, reason: "failed" };
  }

  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);

  return { ok: true, url: data.publicUrl };
}

/**
 * Briše sve logoe jednog salona iz skladišta.
 *
 * Skladište ne zna za strane ključeve, pa brisanje salona iz baze ostavlja
 * slike za sobom. Svaka promena logoa je dodala novu datoteku pod istim
 * prefiksom, pa ih ume biti i nekoliko.
 */
export async function removeLogoFiles(tenantId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(LOGO_BUCKET)
    .list(tenantId);

  if (error || !data || data.length === 0) {
    return;
  }

  await supabase.storage
    .from(LOGO_BUCKET)
    .remove(data.map((file) => `${tenantId}/${file.name}`));
}
