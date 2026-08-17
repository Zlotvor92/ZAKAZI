-- Jedan nalog, više salona.
--
-- Do sada je svaka funkcija uzimala „prvi salon po datumu nastanka". Dok
-- korisnik ima jedan, to je tačno. Čim ima dva — a ti ćeš ih imati, svoj i
-- sestrin — piše se u pogrešan, i to tiho.
--
-- Sve funkcije zato primaju salon. Kad se ne prosledi, ponašaju se kao ranije,
-- pa nalog sa jednim salonom ne mora ništa da zna o ovome.
--
-- Nijedna nije `security definer` osim `create_tenant`: ako pozivalac nije
-- član prosleđenog salona, RLS mu ga ne pokaže i funkcija se ponaša kao da
-- salon ne postoji.

/*
 * Novi salon.
 *
 * `security definer` je ovde neizbežan: ni `tenants` ni `memberships` nemaju
 * politiku za upis, jer bi ona značila da neko sme sebe da ubaci u tuđi salon.
 * Funkcija upisuje isključivo članstvo za onoga ko je zove.
 */
create function create_tenant(
  p_name text,
  p_slug text,
  p_timezone text default 'Europe/Belgrade'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_tenant_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  if v_name = '' or length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  -- Slug završi u adresi koju salon deli na Instagramu, pa sme samo ono što
  -- se može otkucati bez razmišljanja. Ispod tri znaka se ne daje: kratke
  -- adrese su zajednički resurs, ne nagrada za brzinu.
  if length(v_slug) < 3
     or v_slug !~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_slug');
  end if;

  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_timezone');
  end if;

  if exists (select 1 from tenants where slug = v_slug) then
    return jsonb_build_object('ok', false, 'reason', 'slug_taken');
  end if;

  insert into tenants (slug, name, timezone, plan)
  values (v_slug, v_name, p_timezone, 'trial')
  returning id into v_tenant_id;

  insert into memberships (user_id, tenant_id, role)
  values (v_user_id, v_tenant_id, 'owner');

  -- Solo majstor je i vlasnik i izvođač; bez izvođača salon nema radno vreme
  -- ni kome da se zakaže.
  insert into staff (tenant_id, user_id, name)
  values (v_tenant_id, v_user_id, v_name);

  return jsonb_build_object('ok', true, 'id', v_tenant_id, 'slug', v_slug);
end;
$$;

revoke execute on function create_tenant(text, text, text) from public, anon;
grant execute on function create_tenant(text, text, text) to authenticated;

-- Saloni u kojima je pozivalac član, za prebacivanje u zaglavlju.
create function my_tenants() returns table (
  id uuid,
  slug text,
  name text
)
language sql
stable
set search_path = public
as $$
  select t.id, t.slug, t.name from tenants t order by t.created_at
$$;

revoke execute on function my_tenants() from public, anon;
grant execute on function my_tenants() to authenticated;

-- Salon na koji se poziv odnosi: prosleđeni ako je član, inače prvi njegov.
create function resolve_tenant(p_tenant_id uuid) returns uuid
language sql
stable
set search_path = public
as $$
  select id
  from tenants
  where p_tenant_id is null or id = p_tenant_id
  order by created_at
  limit 1
$$;

revoke execute on function resolve_tenant(uuid) from public, anon;
grant execute on function resolve_tenant(uuid) to authenticated;

-- Sve funkcije za vlasnicu dobijaju salon --------------------------------

-- `create or replace` ovde ne bi radio: dodat argument pravi novu funkciju
-- pored stare, pa bi poziv sa jednim argumentom postao dvosmislen.
drop function dashboard_week(date);

create function dashboard_week(
  p_date date default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_tenant tenants;
  v_today date;
  v_monday date;
  v_window tstzrange;
begin
  select * into v_tenant from tenants where id = resolve_tenant(p_tenant_id);

  if not found then
    return null;
  end if;

  v_today := (now() at time zone v_tenant.timezone)::date;
  v_monday := date_trunc('week', coalesce(p_date, v_today))::date;
  v_window := tstzrange(
    v_monday::timestamp at time zone v_tenant.timezone,
    (v_monday + 7)::timestamp at time zone v_tenant.timezone,
    '[)'
  );

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'slug', v_tenant.slug,
      'name', v_tenant.name,
      'timezone', v_tenant.timezone,
      'booking_horizon_days', v_tenant.booking_horizon_days,
      'min_lead_minutes', v_tenant.min_lead_minutes,
      'public_booking_enabled', v_tenant.public_booking_enabled
    ),
    -- Spisak salona putuje uz kalendar: prebacivanje u zaglavlju ne sme da
    -- košta još jedan odlazak do baze na svakom otvaranju strane.
    'tenants', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name)
        order by t.created_at
      )
      from tenants t
    ), '[]'::jsonb),
    'today', v_today,
    'week_start', v_monday,
    'blocks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', wh.weekday,
          'start_minute', (extract(epoch from wh.start_time) / 60)::int,
          'end_minute', (extract(epoch from wh.end_time) / 60)::int,
          'slot_minutes', wh.slot_minutes
        )
        order by wh.weekday, wh.start_time
      )
      from working_hours wh
      where wh.tenant_id = v_tenant.id
    ), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'start_at', a.start_at,
          'end_at', a.end_at,
          'status', a.status,
          'source', a.source,
          'price_rsd', a.price_rsd,
          'duration_min', a.duration_min,
          'client_name', c.name,
          'client_phone', c.phone_e164,
          'service_name', s.name
        )
        order by a.start_at
      )
      from appointments a
      join clients c on c.id = a.client_id
      join services s on s.id = a.service_id
      where a.tenant_id = v_tenant.id
        and a.start_at <@ v_window
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function dashboard_week(date, uuid) from public, anon;
grant execute on function dashboard_week(date, uuid) to authenticated;

drop function tenant_services();

create function tenant_services(p_tenant_id uuid default null) returns table (
  id uuid,
  name text,
  duration_min integer,
  price_rsd integer
)
language sql
stable
set search_path = public
as $$
  select s.id, s.name, s.duration_min, s.price_rsd
  from services s
  where s.tenant_id = resolve_tenant(p_tenant_id) and s.active
  order by s.name
$$;

revoke execute on function tenant_services(uuid) from public, anon;
grant execute on function tenant_services(uuid) to authenticated;

drop function set_working_hours(jsonb);

create function set_working_hours(
  p_blocks jsonb,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_staff_id uuid;
begin
  select id into v_staff_id
  from staff
  where tenant_id = v_tenant_id and active
  order by created_at, id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  delete from working_hours where staff_id = v_staff_id;

  -- Minuti u `time` idu preko niske, jer `make_interval(mins => 1440)::time`
  -- daje 00:00 i time ponoć na kraju dana pretvara u početak dana.
  insert into working_hours
    (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
  select
    v_tenant_id,
    v_staff_id,
    (item->>'weekday')::smallint,
    (lpad(((item->>'start_minute')::int / 60)::text, 2, '0') || ':' ||
     lpad(((item->>'start_minute')::int % 60)::text, 2, '0'))::time,
    (lpad(((item->>'end_minute')::int / 60)::text, 2, '0') || ':' ||
     lpad(((item->>'end_minute')::int % 60)::text, 2, '0'))::time,
    (item->>'slot_minutes')::int
  from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) as item;

  return jsonb_build_object('ok', true);
exception
  when exclusion_violation then
    return jsonb_build_object('ok', false, 'reason', 'overlapping');
  when check_violation or invalid_datetime_format or data_exception then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
end;
$$;

revoke execute on function set_working_hours(jsonb, uuid) from public, anon;
grant execute on function set_working_hours(jsonb, uuid) to authenticated;

drop function add_time_off(timestamptz, timestamptz, text);

create function add_time_off(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason text default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_staff_id uuid;
  v_id uuid;
begin
  if p_start_at >= p_end_at then
    return jsonb_build_object('ok', false, 'reason', 'end_before_start');
  end if;

  select id into v_staff_id
  from staff
  where tenant_id = v_tenant_id and active
  order by created_at, id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  insert into time_off (tenant_id, staff_id, start_at, end_at, reason)
  values (
    v_tenant_id, v_staff_id, p_start_at, p_end_at,
    nullif(btrim(coalesce(p_reason, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function add_time_off(timestamptz, timestamptz, text, uuid)
  from public, anon;
grant execute on function add_time_off(timestamptz, timestamptz, text, uuid)
  to authenticated;

drop function upsert_service(uuid, text, integer, integer);

create function upsert_service(
  p_id uuid,
  p_name text,
  p_duration_min integer,
  p_price_rsd integer,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_staff_id uuid;
  v_name text;
  v_id uuid;
begin
  v_name := btrim(coalesce(p_name, ''));

  if v_name = '' or length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if p_duration_min is null or p_duration_min <= 0 or p_duration_min > 1440 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_duration');
  end if;

  if p_price_rsd is null or p_price_rsd < 0 or p_price_rsd > 10000000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_price');
  end if;

  if v_tenant_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_id is not null then
    -- Izmena mora da pogodi salon u kome se korisnik trenutno nalazi. Bez
    -- toga bi članica dva salona mogla, iz jednog, da prepravi uslugu drugog.
    update services
       set name = v_name,
           duration_min = p_duration_min,
           price_rsd = p_price_rsd
     where id = p_id and tenant_id = v_tenant_id
    returning id into v_id;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  insert into services (tenant_id, name, duration_min, price_rsd)
  values (v_tenant_id, v_name, p_duration_min, p_price_rsd)
  returning id into v_id;

  -- Bez veze sa izvođačem usluga ne bi izašla na javnu stranicu, a salon ne
  -- bi imao gde da vidi zašto.
  select id into v_staff_id
  from staff
  where tenant_id = v_tenant_id and active
  order by created_at, id
  limit 1;

  if v_staff_id is not null then
    insert into staff_services (tenant_id, staff_id, service_id)
    values (v_tenant_id, v_staff_id, v_id)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function upsert_service(uuid, text, integer, integer, uuid)
  from public, anon;
grant execute on function upsert_service(uuid, text, integer, integer, uuid)
  to authenticated;
