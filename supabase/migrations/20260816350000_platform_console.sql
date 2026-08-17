-- Konzola vlasnika platforme.
--
-- Do sada je salon mogao da otvori svako ko se uloguje. To se ukida: salone
-- pravi isključivo vlasnik platforme, jer on odgovara za to ko je u sistemu i
-- ko plaća.
--
-- Uz to dolazi i prekidač po salonu. Suspenzija gasi javno zakazivanje —
-- ono za šta se plaća — a ne dira kalendar. Vlasnica koja nije platila ne sme
-- da ostane bez uvida u sopstvene termine i klijente; treba joj oduzeti ono
-- što je kupila, ne njen radni dan.

alter table tenants add column suspended_at timestamptz;

/*
 * Da li onaj ko zove upravlja platformom.
 *
 * `security definer` jer `platform_owners` nema nijednu politiku i namerno je
 * niko ne čita. Funkcija ne vraća nikakav podatak osim tačno/netačno o samom
 * pozivaocu, pa proširenje prava ne otvara ništa.
 */
create function is_platform_owner() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from platform_owners where user_id = auth.uid()
  )
$$;

revoke execute on function is_platform_owner() from public, anon;
grant execute on function is_platform_owner() to authenticated;

-- Salon pravi samo vlasnik platforme -------------------------------------

drop function create_tenant(text, text, text);

/*
 * Novi salon, sa vlasnicom koja u njemu radi.
 *
 * Nalog vlasnice mora već da postoji — pravi ga server preko admin API-ja pre
 * ovog poziva. Ovde se ne dira `auth.users`: pravljenje naloga iz SQL-a
 * zaobilazi Supabase-ove tokove za potvrdu mejla i prijavu.
 */
create function create_tenant(
  p_name text,
  p_slug text,
  p_owner_email text,
  p_timezone text default 'Europe/Belgrade'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_owner_id uuid;
  v_tenant_id uuid;
begin
  if not is_platform_owner() then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if v_name = '' or length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  -- Slug završi u adresi koju salon deli na Instagramu, pa sme samo ono što
  -- se može otkucati bez razmišljanja.
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

  select id into v_owner_id
  from auth.users
  where lower(email) = lower(btrim(coalesce(p_owner_email, '')));

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_user');
  end if;

  insert into tenants (slug, name, timezone, plan)
  values (v_slug, v_name, p_timezone, 'trial')
  returning id into v_tenant_id;

  insert into memberships (user_id, tenant_id, role)
  values (v_owner_id, v_tenant_id, 'owner');

  -- Vlasnik platforme ulazi u svaki salon čim salon nastane. Da se dodaje
  -- ručno, prvi zaboravljeni salon bio bi salon koji niko ne kontroliše.
  insert into memberships (user_id, tenant_id, role)
  select po.user_id, v_tenant_id, 'owner'
  from platform_owners po
  where po.user_id <> v_owner_id
  on conflict (user_id, tenant_id) do nothing;

  -- Izvođač je vlasnica salona, ne onaj ko je salon otvorio. Bez ovoga bi
  -- klijentkinje zakazivale kod vlasnika platforme.
  insert into staff (tenant_id, user_id, name)
  values (v_tenant_id, v_owner_id, v_name);

  return jsonb_build_object('ok', true, 'id', v_tenant_id, 'slug', v_slug);
end;
$$;

revoke execute on function create_tenant(text, text, text, text)
  from public, anon;
grant execute on function create_tenant(text, text, text, text) to authenticated;

-- Spisak svih salona -----------------------------------------------------

/*
 * Sve što konzoli treba, u jednom pozivu.
 *
 * `where is_platform_owner()` je cela zaštita: ko to nije, dobija prazan
 * spisak, ne grešku. Mejl vlasnice se čita iz `auth.users`, do koga se kroz
 * RLS ne dolazi ni na koji drugi način.
 */
create function admin_salons() returns table (
  id uuid,
  slug text,
  name text,
  suspended boolean,
  owner_email text,
  created_at timestamptz,
  services_count integer,
  upcoming_count integer,
  last_booking_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.slug,
    t.name,
    t.suspended_at is not null,
    (
      -- Vlasnica salona je član koji ne upravlja platformom.
      select u.email::text
      from memberships m
      join auth.users u on u.id = m.user_id
      where m.tenant_id = t.id
        and not exists (
          select 1 from platform_owners po where po.user_id = m.user_id
        )
      order by m.created_at
      limit 1
    ),
    t.created_at,
    (select count(*)::int from services s
      where s.tenant_id = t.id and s.active),
    (select count(*)::int from appointments a
      where a.tenant_id = t.id
        and a.status in ('pending', 'confirmed')
        and a.start_at >= now()),
    (select max(a.created_at) from appointments a where a.tenant_id = t.id)
  from tenants t
  where is_platform_owner()
  order by t.created_at
$$;

revoke execute on function admin_salons() from public, anon;
grant execute on function admin_salons() to authenticated;

-- Prekidač ---------------------------------------------------------------

/*
 * Gasi i pali salon.
 *
 * `suspended_at` je namerno odvojen od `public_booking_enabled`: prvo je
 * odluka platforme, drugo je njena odluka kad ide na godišnji. Da je isto
 * polje, gašenje suspenzije bi joj tiho upalilo nešto što je sama isključila,
 * a ona bi mogla sebi da skine suspenziju.
 *
 * Kolonu `suspended_at` vlasnica ionako ne sme da menja — privilegija nad
 * kolonama nad `tenants` joj daje samo tri polja.
 */
create function set_tenant_suspended(
  p_tenant_id uuid,
  p_suspended boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_owner() then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  update tenants
     set suspended_at = case when p_suspended then now() else null end
   where id = p_tenant_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'suspended', p_suspended);
end;
$$;

revoke execute on function set_tenant_suspended(uuid, boolean) from public, anon;
grant execute on function set_tenant_suspended(uuid, boolean) to authenticated;

-- Suspenzija gasi ono za šta se plaća ------------------------------------

-- Javna stranica ne razlikuje suspendovan salon od nepostojećeg: klijentkinja
-- nema šta da sazna o tuđim računima.
create or replace function public_booking_data(p_slug text) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant tenants;
  v_staff_id uuid;
  v_now timestamptz := now();
  v_from_date date;
  v_to_date date;
  v_window tstzrange;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found
     or not v_tenant.public_booking_enabled
     or v_tenant.suspended_at is not null then
    return null;
  end if;

  v_staff_id := booking_staff_id(v_tenant.id);

  v_from_date := (v_now at time zone v_tenant.timezone)::date;
  v_to_date := v_from_date + v_tenant.booking_horizon_days;
  v_window := tstzrange(
    v_from_date::timestamp at time zone v_tenant.timezone,
    (v_to_date + 1)::timestamp at time zone v_tenant.timezone,
    '[)'
  );

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'name', v_tenant.name,
      'slug', v_tenant.slug,
      'timezone', v_tenant.timezone,
      'min_lead_minutes', v_tenant.min_lead_minutes,
      'brand_background', v_tenant.brand_background,
      'brand_primary', v_tenant.brand_primary,
      'brand_accent', v_tenant.brand_accent
    ),
    'now', v_now,
    'from_date', v_from_date,
    'to_date', v_to_date,
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'duration_min', s.duration_min,
          'price_rsd', s.price_rsd
        )
        order by s.name
      )
      from services s
      where s.tenant_id = v_tenant.id
        and s.active
        and exists (
          select 1 from staff_services ss
          where ss.staff_id = v_staff_id and ss.service_id = s.id
        )
    ), '[]'::jsonb),
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
      where wh.staff_id = v_staff_id
    ), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(
        jsonb_build_object('start_at', taken.start_at, 'end_at', taken.end_at)
        order by taken.start_at
      )
      from (
        select lower(a.blocked_range) as start_at, upper(a.blocked_range) as end_at
        from appointments a
        where a.staff_id = v_staff_id
          and a.status in ('pending', 'confirmed')
          and a.blocked_range && v_window
        union all
        select t.start_at, t.end_at
        from time_off t
        where t.staff_id = v_staff_id
          and tstzrange(t.start_at, t.end_at, '[)') && v_window
      ) taken
    ), '[]'::jsonb)
  );
end;
$$;

-- Ista provera i u samom zakazivanju, ne samo u onome što stranica ponudi:
-- poziv može da stigne i mimo nje.
create or replace function public_book(
  p_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_client_name text,
  p_phone_e164 text,
  p_device_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant tenants;
  v_service services;
  v_staff_id uuid;
  v_now timestamptz := now();
  v_today date;
  v_local_date date;
  v_name text;
  v_client_id uuid;
  v_appointment_id uuid;
  v_limit_reason text;
  v_blocked tstzrange;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found
     or not v_tenant.public_booking_enabled
     or v_tenant.suspended_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'booking_closed');
  end if;

  v_name := btrim(coalesce(p_client_name, ''));
  if v_name = '' or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  v_staff_id := booking_staff_id(v_tenant.id);
  if v_staff_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  select * into v_service
  from services
  where id = p_service_id
    and tenant_id = v_tenant.id
    and active
    and exists (
      select 1 from staff_services ss
      where ss.staff_id = v_staff_id and ss.service_id = services.id
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_service');
  end if;

  v_today := (v_now at time zone v_tenant.timezone)::date;
  v_local_date := (p_start_at at time zone v_tenant.timezone)::date;

  if v_local_date < v_today
     or v_local_date > v_today + v_tenant.booking_horizon_days then
    return jsonb_build_object('ok', false, 'reason', 'outside_window');
  end if;

  if p_start_at < v_now + make_interval(mins => v_tenant.min_lead_minutes) then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;

  if not is_bookable_start(v_staff_id, v_tenant.timezone, p_start_at) then
    return jsonb_build_object('ok', false, 'reason', 'outside_working_hours');
  end if;

  v_blocked := tstzrange(
    p_start_at, p_start_at + make_interval(mins => v_service.duration_min), '[)'
  );

  if exists (
    select 1 from time_off t
    where t.staff_id = v_staff_id
      and tstzrange(t.start_at, t.end_at, '[)') && v_blocked
  ) then
    return jsonb_build_object('ok', false, 'reason', 'time_off');
  end if;

  v_limit_reason := booking_limit_reason(
    v_tenant.id, p_phone_e164, p_start_at, p_device_id
  );

  if v_limit_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_limit_reason);
  end if;

  perform set_config('app.actor_type', 'client', true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);

  begin
    insert into clients (tenant_id, name, phone_e164)
    values (v_tenant.id, v_name, p_phone_e164)
    on conflict (tenant_id, phone_e164) do nothing;

    select id into v_client_id
    from clients
    where tenant_id = v_tenant.id and phone_e164 = p_phone_e164;

    insert into appointments (
      tenant_id, staff_id, service_id, client_id, start_at,
      duration_min, buffer_after_min, price_rsd, status, source, confirmed_at
    ) values (
      v_tenant.id, v_staff_id, v_service.id, v_client_id, p_start_at,
      v_service.duration_min, 0, v_service.price_rsd,
      'confirmed', 'public', v_now
    )
    returning id into v_appointment_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end;

  return jsonb_build_object(
    'ok', true,
    'appointment', jsonb_build_object(
      'id', v_appointment_id,
      'tenant_id', v_tenant.id,
      'timezone', v_tenant.timezone,
      'start_at', p_start_at,
      'end_at', p_start_at + make_interval(mins => v_service.duration_min),
      'service_name', v_service.name,
      'price_rsd', v_service.price_rsd
    )
  );
end;
$$;

-- Vlasnici se kaže da je salon pauziran, umesto da joj link tiho crkne.
create or replace function dashboard_week(
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
      'public_booking_enabled', v_tenant.public_booking_enabled,
      'suspended', v_tenant.suspended_at is not null
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
