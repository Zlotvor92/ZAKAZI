-- Kanonski srpski broj, tačan početak termina, čišćenje pokušaja pretrage -------
--
-- 1. `+381064123456` i `+38164123456` su bili dva različita niza znakova za isti
--    telefon, pa se blocklist i limiti po broju zaobilaze upisom nule posle
--    koda zemlje. Nacionalni broj ne počinje nulom (nula je unutrašnji prefiks
--    koji se pri pretvaranju u E.164 odbacuje). Regularni izraz sada traži
--    prvu cifru 1–9, u tri javne funkcije i u ograničenjima tabela.
--
--    Ograničenja su `not valid`: važe za svaki novi i izmenjen red, a postojeći
--    redovi se ne diraju niti proveravaju. Podatke ne menjam slepo; posle
--    ručnog pregleda (upit ispod) ograničenje se potvrđuje sa `validate`.
--
--      select 'clients', id, tenant_id, phone_e164 from clients
--       where phone_e164 ~ '^\+3810'
--      union all
--      select 'limit_exempt_phones', null, tenant_id, phone_e164
--        from limit_exempt_phones where phone_e164 ~ '^\+3810';
--
--    alter table clients validate constraint clients_phone_e164_format;
--    alter table limit_exempt_phones
--      validate constraint limit_exempt_phones_phone_e164_check;
--
-- 2. `is_bookable_start` poredi `extract(epoch …)::bigint`, koji zaokružuje,
--    pa je `09:00:00.4` prolazilo kao tačan početak. Početak mora da bude na
--    celom minutu, i to proverava baza, ne samo stranica.
--
-- 3. `phone_lookup_attempts` nije imala čišćenje. Zapisi stariji od dana nikome
--    ne trebaju (limit gleda poslednjih 60 minuta); briše ih noćni posao koji
--    već postoji.

alter table clients
  drop constraint clients_phone_e164_format,
  add constraint clients_phone_e164_format
    check (phone_e164 ~ '^\+381[1-9][0-9]{7,8}$') not valid;

alter table limit_exempt_phones
  drop constraint limit_exempt_phones_phone_e164_check,
  add constraint limit_exempt_phones_phone_e164_check
    check (phone_e164 ~ '^\+381[1-9][0-9]{7,8}$') not valid;

create or replace function public_book(p_slug text, p_service_id uuid, p_start_at timestamp with time zone, p_client_name text, p_phone_e164 text, p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window jsonb;
  v_sequence jsonb;
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
  v_network_hash text;
  v_replay jsonb;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found
     or not v_tenant.public_booking_enabled
     or v_tenant.suspended_at is not null
     or subscription_expired(v_tenant.paid_until, v_tenant.timezone) then
    return jsonb_build_object('ok', false, 'reason', 'booking_closed');
  end if;

  v_name := btrim(coalesce(p_client_name, ''));
  if v_name = '' or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+381[1-9][0-9]{7,8}$'
     or phone_looks_fake(p_phone_e164) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  -- Limit po broju se proverava pa tek onda upisuje; bez zaključavanja su
  -- paralelni zahtevi istog broja svi videli isti broj termina i prošli.
  -- Zaključava se samo par salon + broj, i to pre provere ponovljenog zahteva:
  -- zahtev koji je čekao na bravu mora da vidi termin koji je pobednik upravo
  -- upisao, inače bi umesto istog termina dobio odbijenicu.
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant.id::text || ':' || p_phone_e164, 0)
  );

  -- Isti zahtev poslat ponovo (odgovor se izgubio, pa je klijentkinja
  -- pokušala opet) vraća termin koji već postoji. Ovo mora pre limita: inače
  -- bi ponavljanje odmah naišlo na `too_fast` za termin koji je njen.
  v_replay := booking_replay(
    v_tenant.id, p_request_id, p_phone_e164, p_service_id, p_start_at
  );

  if v_replay is not null then
    return v_replay;
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

  -- Korekcija posle roka nije korekcija: na stolici se radi nov set, duži
  -- termin, i sve posle nje kasni. Klijentkinja se šalje na pravu uslugu.
  v_window := service_window_problem(
    v_service.id, p_phone_e164, v_tenant.id, p_start_at
  );

  if v_window is not null then
    return jsonb_build_object('ok', false, 'reason', 'service_window')
      || v_window;
  end if;

  -- Korekcija posle skidanja, ili skidanje pred već zakazanu korekciju.
  v_sequence := service_sequence_problem(
    v_service.id, p_phone_e164, v_tenant.id, p_start_at
  );

  if v_sequence is not null then
    -- Datum u poruci se piše po satu salona, ne servera.
    return jsonb_build_object(
      'ok', false,
      'reason', 'service_sequence',
      'timezone', v_tenant.timezone
    ) || v_sequence;
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

  if not is_bookable_start(
       v_staff_id, v_tenant.timezone, p_start_at, v_service.duration_min
     ) then
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

  v_network_hash := effective_network_hash(v_tenant.id, p_network_hash);

  v_limit_reason := booking_limit_reason(
    v_tenant.id, p_phone_e164, p_start_at, p_device_id, v_network_hash
  );

  if v_limit_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_limit_reason);
  end if;

  perform set_config('app.actor_type', 'client', true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);
  perform set_config('app.network_hash', coalesce(v_network_hash, ''), true);

  -- Dva zahteva za isti termin koji se istovremeno upisuju u ograničenje
  -- preklapanja vide jedan drugog i čekaju jedan na drugog: Postgres posle
  -- sekundu prekine jednog sa `deadlock detected`. Redosled po izvođaču to
  -- sprečava, pa gubitnik odmah dobija `slot_taken`.
  perform pg_advisory_xact_lock(hashtextextended(v_staff_id::text, 1));

  begin
    insert into clients (tenant_id, name, phone_e164)
    values (v_tenant.id, v_name, p_phone_e164)
    on conflict (tenant_id, phone_e164) do nothing;

    select id into v_client_id
    from clients
    where tenant_id = v_tenant.id and phone_e164 = p_phone_e164;

    insert into appointments (
      tenant_id, staff_id, service_id, client_id, start_at,
      duration_min, buffer_after_min, price_rsd, status, source, confirmed_at,
      request_id
    ) values (
      v_tenant.id, v_staff_id, v_service.id, v_client_id, p_start_at,
      v_service.duration_min, 0, v_service.price_rsd,
      'confirmed', 'public', v_now,
      p_request_id
    )
    returning id into v_appointment_id;
  exception when exclusion_violation or unique_violation or deadlock_detected then
    -- Dva istovremena zahteva sa istim `request_id`: gubitnik ne sme da dobije
    -- `slot_taken` za termin koji je upravo njegov.
    v_replay := booking_replay(
      v_tenant.id, p_request_id, p_phone_e164, p_service_id, p_start_at
    );

    if v_replay is not null then
      return v_replay;
    end if;

    if sqlstate not in ('23P01', '40P01') then
      raise;
    end if;

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

create or replace function public_cancel_appointment(p_slug text, p_phone_e164 text, p_appointment_id uuid, p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text)
 RETURNS jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant tenants;
  v_from appointment_status;
  v_client_name text;
  v_service_name text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_network_hash text;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+381[1-9][0-9]{7,8}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  v_network_hash := effective_network_hash(v_tenant.id, p_network_hash);
  insert into phone_lookup_attempts (tenant_id, network_hash)
  values (v_tenant.id, coalesce(v_network_hash, 'unknown'));

  if phone_lookup_limit_reason(v_tenant.id, v_network_hash, p_phone_e164) is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- `for update` da dupli dodir na dugme ili dve kartice ne bi otkazale isti
  -- termin dvaput sa dva različita ishoda u audit logu.
  select a.status, a.start_at, a.end_at, c.name, s.name
    into v_from, v_start_at, v_end_at, v_client_name, v_service_name
  from appointments a
  join clients c on c.id = a.client_id
  join services s on s.id = a.service_id
  where a.id = p_appointment_id
    and a.tenant_id = v_tenant.id
    and c.phone_e164 = p_phone_e164
  for update of a;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_from in ('cancelled_by_client', 'cancelled_by_salon') then
    return jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  end if;

  if not appointment_status_allowed(v_from, 'cancelled_by_client') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;

  perform set_config('app.actor_type', 'client', true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);
  perform set_config('app.network_hash', coalesce(v_network_hash, ''), true);

  update appointments set status = 'cancelled_by_client'
  where id = p_appointment_id;

  return jsonb_build_object(
    'ok', true,
    'appointment', jsonb_build_object(
      'id', p_appointment_id,
      'tenant_id', v_tenant.id,
      'timezone', v_tenant.timezone,
      'start_at', v_start_at,
      'end_at', v_end_at,
      'client_name', v_client_name,
      'service_name', v_service_name
    )
  );
end;
$$;

create or replace function public_appointments_for_phone(p_slug text, p_phone_e164 text, p_network_hash text DEFAULT NULL::text)
 RETURNS jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant tenants;
  v_network_hash text;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return null;
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+381[1-9][0-9]{7,8}$' then
    return '[]'::jsonb;
  end if;

  v_network_hash := effective_network_hash(v_tenant.id, p_network_hash);
  insert into phone_lookup_attempts (tenant_id, network_hash)
  values (v_tenant.id, coalesce(v_network_hash, 'unknown'));

  -- Namerno ista prazna lista kao za "taj broj nema termina": ko pogađa
  -- brojeve ne sme da vidi razliku između "nema termina" i "prebrzo pokušavaš".
  if phone_lookup_limit_reason(v_tenant.id, v_network_hash, p_phone_e164) is not null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'start_at', a.start_at,
        'end_at', a.end_at,
        'service_name', s.name,
        'price_rsd', a.price_rsd
      )
      order by a.start_at
    )
    from appointments a
    join clients c on c.id = a.client_id
    join services s on s.id = a.service_id
    where a.tenant_id = v_tenant.id
      and c.phone_e164 = p_phone_e164
      and a.status in ('pending', 'confirmed')
      and a.start_at >= now()
  ), '[]'::jsonb);
end;
$$;

create or replace function is_bookable_start(p_staff_id uuid, p_timezone text, p_start_at timestamp with time zone, p_duration_min integer)
 RETURNS boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from working_hours wh
    join tenants t on t.id = wh.tenant_id,
    lateral (
      select (p_start_at at time zone p_timezone)::date as local_date
    ) d,
    lateral (
      select (d.local_date + wh.start_time) at time zone p_timezone as opens,
             (d.local_date + wh.end_time) at time zone p_timezone as closes,
             exists (
               select 1
               from working_hours w2
               where w2.staff_id = wh.staff_id
                 and w2.weekday = wh.weekday
                 and w2.start_time > wh.start_time
             ) as break_follows
    ) b
    where wh.staff_id = p_staff_id
      and wh.weekday = extract(isodow from d.local_date)
      -- Početak na celom minutu: `::bigint` niže zaokružuje razlomak sekunde.
      and date_trunc('minute', p_start_at) = p_start_at
      and p_start_at >= b.opens
      and p_start_at < b.closes
      and p_start_at + make_interval(mins => p_duration_min)
            <= b.closes + make_interval(
                 mins => case when b.break_follows
                              then t.break_overrun_min
                              else t.shift_overrun_min
                         end
               )
      and (
        -- Raspored salona.
        extract(epoch from (p_start_at - b.opens))::bigint
          % (wh.slot_minutes * 60) = 0
        -- Ili tačno kraj nečega što je do tada zauzimalo izvođača.
        or exists (
          select 1
          from appointments a
          where a.staff_id = p_staff_id
            and a.status in ('pending', 'confirmed')
            and upper(a.blocked_range) = p_start_at
        )
        or exists (
          select 1
          from time_off t2
          where t2.staff_id = p_staff_id
            and t2.end_at = p_start_at
        )
      )
  )
$$;

create function prune_phone_lookup_attempts(p_now timestamptz default now())
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from phone_lookup_attempts
   where created_at < p_now - interval '1 day';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function prune_phone_lookup_attempts(timestamptz)
  from public, anon, authenticated;
grant execute on function prune_phone_lookup_attempts(timestamptz)
  to service_role;
