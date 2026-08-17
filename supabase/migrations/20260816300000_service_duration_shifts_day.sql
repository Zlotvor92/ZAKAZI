-- Trajanje usluge se vraća, ali sa drugim poslom nego ranije.
--
-- Razmak u bloku i dalje kaže kad se dolazi: 09:00–12:00 na sat i po znači 9 i
-- 10:30. Trajanje usluge kaže koliko taj dolazak stvarno oduzme, i time gura
-- ono što ide za njim: dvočasovna nadogradnja u 9 pomeri sledeći sa 10:30 na
-- 11:00.
--
-- Poslednji termin sme da pređe kraj bloka. Salon koji radi do 12 a završi u
-- 12:30 nije prekršio ništa, pa se mesto broji po tome kad se počinje.

alter table services add column duration_min integer;

update services set duration_min = 60;

alter table services
  alter column duration_min set not null,
  add constraint services_duration_range
    check (duration_min > 0 and duration_min <= 1440);

-- Razmak sme da bude duži od bloka: to je salon koji prima jednom i završi
-- kad završi.
alter table working_hours drop constraint working_hours_slot_fits;

drop function slot_minutes_at(uuid, text, timestamptz);

/*
 * Da li se u dati trenutak sme početi.
 *
 * Dozvoljena su dva mesta: raspored salona, i trenutak u kom se završava neki
 * već zakazan termin. Drugo je ono što pomera dan kad usluga potraje duže od
 * razmaka.
 */
create function is_bookable_start(
  p_staff_id uuid,
  p_timezone text,
  p_start_at timestamptz
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from working_hours wh,
         lateral (
           select (p_start_at at time zone p_timezone)::date as local_date
         ) d,
         lateral (
           select (d.local_date + wh.start_time) at time zone p_timezone as opens,
                  (d.local_date + wh.end_time) at time zone p_timezone as closes
         ) b
    where wh.staff_id = p_staff_id
      and wh.weekday = extract(isodow from d.local_date)
      and p_start_at >= b.opens
      and p_start_at < b.closes
      and (
        -- Raspored salona.
        extract(epoch from (p_start_at - b.opens))::bigint
          % (wh.slot_minutes * 60) = 0
        -- Ili tačno kraj nekog termina u tom bloku.
        or exists (
          select 1
          from appointments a
          where a.staff_id = p_staff_id
            and a.status in ('pending', 'confirmed')
            and upper(a.blocked_range) = p_start_at
            and a.start_at >= b.opens
            and a.start_at < b.closes
        )
      )
  )
$$;

revoke execute on function is_bookable_start(uuid, text, timestamptz)
  from public, anon, authenticated;

-- public_booking_data: usluga ponovo nosi trajanje ------------------------

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

  if not found or not v_tenant.public_booking_enabled then
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
      'min_lead_minutes', v_tenant.min_lead_minutes
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

-- public_book: trajanje sa usluge, mesto po rasporedu ili iza tuđeg kraja --

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

  if not found or not v_tenant.public_booking_enabled then
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
      'start_at', p_start_at,
      'end_at', p_start_at + make_interval(mins => v_service.duration_min),
      'service_name', v_service.name,
      'price_rsd', v_service.price_rsd
    )
  );
end;
$$;

-- tenant_services: vlasnica vidi i trajanje -------------------------------

drop function tenant_services();

create function tenant_services() returns table (
  id uuid,
  name text,
  duration_min integer,
  price_rsd integer
)
language sql
stable
set search_path = public
as $$
  select id, name, duration_min, price_rsd
  from services
  where active
  order by name
$$;

revoke execute on function tenant_services() from public, anon;
grant execute on function tenant_services() to authenticated;
