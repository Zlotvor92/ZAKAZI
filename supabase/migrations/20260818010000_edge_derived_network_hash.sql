-- Skripta koja anon ključem zove `public_book` direktno (mimo Next.js-a) sama
-- bira šta šalje kao `p_network_hash` i `p_device_id` — a `booking_limit_reason`
-- je, kad ijedan od njih izostane, do sada prosto puštala zahtev kroz, umesto
-- da padne na nešto što pozivalac ne bira sam.
--
-- Kad `p_network_hash` izostane, sad se koristi adresa koju PostgREST/Kong
-- sami vide na ovom zahtevu (`request.headers`, ključ `x-real-ip`) — to
-- pozivalac ne šalje, Kong je upisuje sam na osnovu prave TCP konekcije, pa
-- se ne može lažirati slanjem drugačijeg zaglavlja (provereno: poslato
-- `X-Forwarded-For: 9.9.9.9` stiže kao `x-real-ip` sa pravom adresom
-- konekcije, ne sa lažiranom). Kad aplikacija ide preko Next.js-a, ionako se
-- šalje prava, tačnija vrednost (adresa posetioca kako je vidi Vercel), pa se
-- ovo javlja samo direktnim pozivima mimo aplikacije — tačno slučaj koji je
-- trebalo zatvoriti.

create function effective_network_hash(p_tenant_id uuid, p_client_hash text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_headers text;
  v_addr text;
begin
  if p_client_hash is not null and p_client_hash <> '' then
    return p_client_hash;
  end if;

  v_headers := current_setting('request.headers', true);
  if v_headers is null then
    return null;
  end if;

  v_addr := nullif(v_headers::json ->> 'x-real-ip', '');
  if v_addr is null then
    return null;
  end if;

  return 'edge:' || encode(digest(p_tenant_id::text || ':' || v_addr, 'sha256'), 'hex');
exception when invalid_text_representation then
  -- Zaglavlje koje se ne parsira kao json (npr. neki neočekivan posrednik)
  -- ne sme da obori zakazivanje — ali ništa šire od ovoga: prava greška
  -- (npr. u samoj funkciji) mora da se vidi, ne da se tiho pretvori u null.
  return null;
end;
$$;

revoke execute on function effective_network_hash(uuid, text) from public, anon;
grant execute on function effective_network_hash(uuid, text) to authenticated;

drop function booking_limit_reason(uuid, text, timestamptz, text, text);

create function booking_limit_reason(
  p_tenant_id uuid,
  p_phone_e164 text,
  p_start_at timestamptz,
  p_device_id text,
  p_network_hash text default null
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_week_days constant integer := 7;
  c_max_per_week constant integer := 2;
  c_max_upcoming_new constant integer := 4;
  c_max_upcoming_known constant integer := 6;
  c_max_upcoming_device constant integer := 6;
  c_cooldown_seconds constant integer := 30;
  c_network_window_minutes constant integer := 60;
  c_max_per_network constant integer := 8;

  v_now timestamptz := now();
  v_known_client boolean;
  v_max_upcoming integer;
  v_count integer;
  v_last_booking timestamptz;
  v_network_hash text;
begin
  if exists (
    select 1 from blocklist b
    where b.tenant_id = p_tenant_id and b.phone_e164 = p_phone_e164
  ) then
    return 'blocked';
  end if;

  select count(*) into v_count
  from appointments a
  join clients c on c.id = a.client_id
  where a.tenant_id = p_tenant_id
    and c.phone_e164 = p_phone_e164
    and a.status in ('pending', 'confirmed')
    and a.start_at >= v_now
    and a.start_at between p_start_at - make_interval(days => c_week_days)
                       and p_start_at + make_interval(days => c_week_days);

  if v_count >= c_max_per_week then
    return 'too_many_this_week';
  end if;

  select exists (
    select 1
    from appointments a
    join clients c on c.id = a.client_id
    where a.tenant_id = p_tenant_id
      and c.phone_e164 = p_phone_e164
      and a.status = 'completed'
  ) into v_known_client;

  select count(*) into v_count
  from appointments a
  join clients c on c.id = a.client_id
  where a.tenant_id = p_tenant_id
    and c.phone_e164 = p_phone_e164
    and a.status in ('pending', 'confirmed')
    and a.start_at >= v_now;

  v_max_upcoming := case
    when v_known_client then c_max_upcoming_known
    else c_max_upcoming_new
  end;

  if v_count >= v_max_upcoming then
    return 'too_many_upcoming';
  end if;

  -- Efektivna mreža: ono što je pozivalac poslao, ili — kad ništa nije
  -- poslao — ono što Kong sam vidi. Za razliku od pre, provera se sad radi
  -- uvek kad postoji bilo koja od te dve vrednosti, ne samo kad je pozivalac
  -- odlučio da nešto pošalje.
  v_network_hash := effective_network_hash(p_tenant_id, p_network_hash);

  if v_network_hash is not null then
    select count(*) into v_count
    from appointment_events e
    where e.tenant_id = p_tenant_id
      and e.network_hash = v_network_hash
      and e.from_status is null
      and e.created_at >= v_now
                        - make_interval(mins => c_network_window_minutes);

    if v_count >= c_max_per_network then
      return 'too_many_from_network';
    end if;
  end if;

  if p_device_id is null or p_device_id = '' then
    return null;
  end if;

  select count(*), max(e.created_at)
    into v_count, v_last_booking
  from appointment_events e
  join appointments a on a.id = e.appointment_id
  where e.tenant_id = p_tenant_id
    and e.device_id = p_device_id
    and e.from_status is null
    and a.status in ('pending', 'confirmed')
    and a.start_at >= v_now;

  if v_count >= c_max_upcoming_device then
    return 'too_many_from_device';
  end if;

  if v_last_booking is not null
     and v_last_booking > v_now - make_interval(secs => c_cooldown_seconds) then
    return 'too_fast';
  end if;

  return null;
end;
$$;

revoke execute on function
  booking_limit_reason(uuid, text, timestamptz, text, text)
  from public, anon;

-- `public_book` sad računa istu efektivnu vrednost i nju upisuje u
-- `appointment_events` (preko `app.network_hash`) — inače bi provera iznad
-- brojala Kong-ovu adresu, a u istoriju bi i dalje upadala prazna vrednost
-- koju je pozivalac poslao (ili nije), pa se ništa ne bi ni nabrajalo.
create or replace function public_book(
  p_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_client_name text,
  p_phone_e164 text,
  p_device_id text default null,
  p_network_hash text default null
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
  v_network_hash text;
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

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$'
     or phone_looks_fake(p_phone_e164) then
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

revoke execute on function
  public_book(text, uuid, timestamptz, text, text, text, text)
  from public, anon;
grant execute on function
  public_book(text, uuid, timestamptz, text, text, text, text)
  to anon, authenticated;
