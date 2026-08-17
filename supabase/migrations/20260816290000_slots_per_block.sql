-- Termin više ne traje koliko usluga, nego koliko salon kaže da traje termin
-- u tom komadu radnog vremena.
--
-- Solo majstor ne razmišlja u minutima nego u ljudima: „pre podne primam
-- dvoje". Mreža od petnaest minuta je uz to pravila rupe koje niko ne kupuje.
-- Blok 09:00–12:00 sa terminom od 90 minuta znači dva termina, u 9 i u 10:30,
-- i između njih nema šta da se izgubi.
--
-- Trajanje usluge time prestaje da postoji kao pojam: salon je napravio blok i
-- zna šta u njega staje, a aplikacija ne pogađa umesto njega.

alter table working_hours add column slot_minutes integer;

-- Postojeći redovi dobijaju sat vremena, ili ceo blok ako je kraći od sata.
update working_hours
   set slot_minutes = least(
     60,
     (extract(epoch from (end_time - start_time)) / 60)::int
   );

alter table working_hours
  alter column slot_minutes set not null,
  add constraint working_hours_slot_positive check (slot_minutes > 0),
  -- Termin duži od komada rada znači komad u koji ne staje niko.
  add constraint working_hours_slot_fits
    check (slot_minutes <= extract(epoch from (end_time - start_time)) / 60);

alter table services
  drop column duration_min,
  drop column buffer_after_min;

-- set_working_hours ------------------------------------------------------

drop function set_working_hours(jsonb);

create function set_working_hours(p_blocks jsonb) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_tenant_id uuid;
begin
  select id, tenant_id into v_staff_id, v_tenant_id
  from staff
  where active
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

revoke execute on function set_working_hours(jsonb) from public, anon;
grant execute on function set_working_hours(jsonb) to authenticated;

-- Trajanje termina koji počinje u dati trenutak, po radnom vremenu izvođača.
-- `null` kad taj trenutak nije početak nijednog termina.
create function slot_minutes_at(
  p_staff_id uuid,
  p_timezone text,
  p_start_at timestamptz
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select wh.slot_minutes
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
    and p_start_at + make_interval(mins => wh.slot_minutes) <= b.closes
    -- Početak mora da padne tačno na granicu termina u tom bloku.
    and extract(epoch from (p_start_at - b.opens))::bigint
        % (wh.slot_minutes * 60) = 0
  limit 1
$$;

revoke execute on function slot_minutes_at(uuid, text, timestamptz)
  from public, anon, authenticated;

-- public_booking_data ----------------------------------------------------

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
    -- Bez trajanja: koliko termin traje sada zavisi od bloka, ne od usluge.
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', s.id, 'name', s.name, 'price_rsd', s.price_rsd)
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

-- public_book ------------------------------------------------------------

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
  v_slot_minutes integer;
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

  -- Traženi trenutak mora biti početak nekog termina u radnom vremenu, a ne
  -- bilo koje vreme koje slučajno pada unutar njega.
  v_slot_minutes := slot_minutes_at(v_staff_id, v_tenant.timezone, p_start_at);
  if v_slot_minutes is null then
    return jsonb_build_object('ok', false, 'reason', 'outside_working_hours');
  end if;

  v_blocked := tstzrange(
    p_start_at, p_start_at + make_interval(mins => v_slot_minutes), '[)'
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
      v_slot_minutes, 0, v_service.price_rsd,
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
      'end_at', p_start_at + make_interval(mins => v_slot_minutes),
      'service_name', v_service.name,
      'price_rsd', v_service.price_rsd
    )
  );
end;
$$;

-- create_appointment -----------------------------------------------------

drop function create_appointment(uuid, timestamptz, text, text, text);

create function create_appointment(
  p_service_id uuid,
  p_start_at timestamptz,
  p_duration_min integer,
  p_client_name text,
  p_phone_e164 text,
  p_device_id text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_service services;
  v_staff_id uuid;
  v_name text;
  v_client_id uuid;
  v_appointment_id uuid;
begin
  v_name := btrim(coalesce(p_client_name, ''));
  if v_name = '' or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  if p_duration_min is null or p_duration_min <= 0 or p_duration_min > 1440 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_duration');
  end if;

  select * into v_service from services where id = p_service_id and active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_service');
  end if;

  select id into v_staff_id
  from staff
  where tenant_id = v_service.tenant_id and active
  order by created_at, id
  limit 1;

  if v_staff_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  perform set_config('app.device_id', coalesce(p_device_id, ''), true);

  begin
    insert into clients (tenant_id, name, phone_e164)
    values (v_service.tenant_id, v_name, p_phone_e164)
    on conflict (tenant_id, phone_e164) do nothing;

    select id into v_client_id
    from clients
    where tenant_id = v_service.tenant_id and phone_e164 = p_phone_e164;

    insert into appointments (
      tenant_id, staff_id, service_id, client_id, start_at,
      duration_min, buffer_after_min, price_rsd, status, source, confirmed_at
    ) values (
      v_service.tenant_id, v_staff_id, v_service.id, v_client_id, p_start_at,
      p_duration_min, 0, v_service.price_rsd, 'confirmed', 'salon', now()
    )
    returning id into v_appointment_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end;

  return jsonb_build_object('ok', true, 'appointment_id', v_appointment_id);
end;
$$;

revoke execute on function
  create_appointment(uuid, timestamptz, integer, text, text, text)
  from public, anon;
grant execute on function
  create_appointment(uuid, timestamptz, integer, text, text, text)
  to authenticated;

-- tenant_services --------------------------------------------------------

drop function tenant_services();

create function tenant_services() returns table (
  id uuid,
  name text,
  price_rsd integer
)
language sql
stable
set search_path = public
as $$
  select id, name, price_rsd
  from services
  where active
  order by name
$$;

revoke execute on function tenant_services() from public, anon;
grant execute on function tenant_services() to authenticated;

-- dashboard_week ---------------------------------------------------------

create or replace function dashboard_week(p_date date default null) returns jsonb
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
  select * into v_tenant from tenants order by created_at limit 1;

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
      where a.start_at <@ v_window
    ), '[]'::jsonb)
  );
end;
$$;
