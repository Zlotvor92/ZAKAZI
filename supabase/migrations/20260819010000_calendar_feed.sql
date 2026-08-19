-- Kalendar salona u telefonu vlasnice ---------------------------------------
--
-- Vlasnica već ima kalendar u aplikaciji, ali mora da ga otvori. Termin koji
-- neko zakaže dok ona radi ne stigne nigde osim u push obaveštenje, koje se
-- lako propusti. Ovo pušta njen salonski kalendar u telefonski: Google,
-- Apple ili bilo koji drugi sam povlači adresu na svakih nekoliko sati.
--
-- Adresa je jedina lozinka koju kalendar aplikacija ume da ponese — one ne
-- umeju da se prijave. Zato je token slučajan `uuid`, ne postoji dok ga
-- vlasnica ne uključi, i menja se jednim potezom ako procuri.

alter table tenants add column calendar_token uuid;

-- Traženje po tokenu mora biti tačno jedan red, i mora biti brzo: kalendar
-- aplikacije umeju da zovu često i sa više uređaja.
create unique index tenants_calendar_token_key
  on tenants (calendar_token)
  where calendar_token is not null;

/**
 * Uključuje kalendar, ili pravi novu adresu ako je stara procurela.
 *
 * Stara adresa prestaje da radi u istom trenutku — to je i cela svrha.
 */
create function set_calendar_token(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if not is_tenant_member(p_tenant_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  update tenants
  set calendar_token = gen_random_uuid()
  where id = p_tenant_id
  returning calendar_token into v_token;

  if v_token is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

revoke execute on function set_calendar_token(uuid) from public, anon;
grant execute on function set_calendar_token(uuid) to authenticated;

/** Gasi kalendar. Adresa koja je nekome ostala u telefonu prestaje da radi. */
create function clear_calendar_token(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_tenant_member(p_tenant_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  update tenants set calendar_token = null where id = p_tenant_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function clear_calendar_token(uuid) from public, anon;
grant execute on function clear_calendar_token(uuid) to authenticated;

/**
 * Termini za kalendar aplikaciju.
 *
 * Zove se bez prijave, jer kalendar aplikacija ne ume da se prijavi — token
 * u adresi je jedini dokaz. Netačan token ne vraća nijedan red i ne razlikuje
 * se od tačnog tokena salona bez termina.
 *
 * Prozor je namerno uzak sa obe strane: unazad toliko da se vidi šta je bilo
 * ove nedelje, unapred koliko iko zakazuje. Ceo istorijat u telefonu nikome
 * ne treba, a svaki red koji izađe je red koji je procurio ako adresa procuri.
 *
 * Otkazani termini se ne šalju — kalendar ih briše kad nestanu iz odgovora.
 */
create function calendar_feed(p_token uuid)
returns table (
  tenant_name text,
  timezone text,
  appointment_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  service_name text,
  staff_name text,
  client_name text,
  client_phone text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.name,
    t.timezone,
    a.id,
    a.start_at,
    a.end_at,
    s.name,
    st.name,
    c.name,
    c.phone_e164,
    a.status::text
  from tenants t
  join appointments a on a.tenant_id = t.id
  join services s on s.tenant_id = a.tenant_id and s.id = a.service_id
  join staff st on st.tenant_id = a.tenant_id and st.id = a.staff_id
  join clients c on c.tenant_id = a.tenant_id and c.id = a.client_id
  where p_token is not null
    and t.calendar_token = p_token
    and a.status in ('pending', 'confirmed')
    and a.start_at >= now() - interval '7 days'
    and a.start_at <= now() + interval '180 days'
  order by a.start_at;
$$;

revoke execute on function calendar_feed(uuid) from public;
grant execute on function calendar_feed(uuid) to anon, authenticated;
