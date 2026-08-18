-- Boje salona su radile od migracije koja ih je uvela, ali samo ako se upišu
-- direktno u bazu — u aplikaciji nije postojalo nijedno polje za njih.
--
-- `security definer` je nužan: migracija 20260816260000 je namerno oduzela
-- `update` nad `tenants` i vratila ga samo za tri kolone pravila zakazivanja,
-- pa vlasnica nema privilegiju nad `brand_*` kolonama. Članstvo se proverava
-- ovde, isto kao što bi ga proverio RLS.
--
-- Logo (`set_tenant_logo`) namerno ostaje na vlasniku platforme: on je
-- datoteka koja se šalje na server. Boje su samo tri heks vrednosti i tiču se
-- salonovog izgleda, pa ih vlasnica menja sama.

create function set_tenant_brand(
  p_tenant_id uuid,
  p_background text,
  p_primary text,
  p_accent text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_background text := nullif(lower(btrim(coalesce(p_background, ''))), '');
  v_primary text := nullif(lower(btrim(coalesce(p_primary, ''))), '');
  v_accent text := nullif(lower(btrim(coalesce(p_accent, ''))), '');
begin
  if not is_tenant_member(p_tenant_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if (v_background is not null and v_background !~ '^#[0-9a-f]{6}$')
     or (v_primary is not null and v_primary !~ '^#[0-9a-f]{6}$')
     or (v_accent is not null and v_accent !~ '^#[0-9a-f]{6}$') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_color');
  end if;

  -- Pozadina i osnovna boja idu u paru: `brandVariables` vraća `null` ako
  -- ijedna nedostaje, pa bi salon koji postavi samo jednu mislio da je
  -- sačuvao boje dok bi javna strana ostala podrazumevana.
  if (v_background is null) <> (v_primary is null) then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  -- Naglasak bez para nema šta da naglasi.
  if v_background is null and v_accent is not null then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  update tenants
  set brand_background = v_background,
      brand_primary = v_primary,
      brand_accent = v_accent
  where id = p_tenant_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function set_tenant_brand(uuid, text, text, text)
  from public, anon;
grant execute on function set_tenant_brand(uuid, text, text, text)
  to authenticated;
