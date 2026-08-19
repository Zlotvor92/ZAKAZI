-- Brisanje salona iz konzole ------------------------------------------------
--
-- Pauziranje gasi link za zakazivanje, ali salon ostaje u bazi zauvek. Posle
-- probnih naloga i salona koji nikad nisu proradili, spisak u konzoli postane
-- neupotrebljiv. Ovo je jedini način da red nestane.
--
-- Sve što visi o salonu odlazi sa njim: `tenants` je roditelj svakoj tabeli
-- sa podacima korisnika, i svaki strani ključ ka njemu nosi `on delete
-- cascade`. Termini, klijentkinje, usluge, radno vreme, članstva, pretplate
-- na obaveštenja i istorija izmena — sve.
--
-- Nepovratno je. Zato se potvrda traži i ovde, ne samo u pregledaču.

create function delete_tenant(p_tenant_id uuid, p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_name text;
begin
  if not is_platform_owner() then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  select slug, name into v_slug, v_name
  from tenants
  where id = p_tenant_id;

  if v_slug is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Prekucana adresa salona je jedina zaštita od pogrešnog reda u spisku.
  -- Provera stoji u bazi jer uslov koji živi samo u pregledaču nije uslov.
  if p_slug is distinct from v_slug then
    return jsonb_build_object('ok', false, 'reason', 'slug_mismatch');
  end if;

  delete from tenants where id = p_tenant_id;

  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

revoke execute on function delete_tenant(uuid, text) from public, anon;
grant execute on function delete_tenant(uuid, text) to authenticated;
