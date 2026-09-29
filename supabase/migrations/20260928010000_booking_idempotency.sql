-- Zakazivanje je idempotentno: isti zahtev dvaput daje isti termin ---------------
--
-- Kad se odgovor izgubi (mobilna mreža), klijentkinja ne zna da je termin
-- zakazan i šalje zahtev ponovo. Stranica sada uz zahtev šalje `request_id`
-- (UUID koji nastaje u pregledaču i ostaje isti dok god odgovor nije stigao).
-- Ako termin sa tim `request_id` već postoji, vraća se on, sa `replayed: true`,
-- a ništa se ne upisuje: nema novog klijenta, događaja ni obaveštenja.
--
-- Ograničenje preklapanja ostaje netaknuto i dalje je jedina odbrana od
-- dvostrukog zauzimanja istog termina.

alter table appointments add column request_id uuid;

create unique index appointments_request_id_key
  on appointments (tenant_id, request_id)
  where request_id is not null;

-- Odgovor za već viđen zahtev. `null` kad zahtev nije viđen. Ako je isti
-- `request_id` upotrebljen za drugi broj, uslugu ili vreme, ne otkriva se ništa
-- o tuđem terminu: samo se odbija.
create function booking_replay(
  p_tenant_id uuid,
  p_request_id uuid,
  p_phone_e164 text,
  p_service_id uuid,
  p_start_at timestamptz
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_found record;
begin
  if p_request_id is null then
    return null;
  end if;

  select a.id, a.start_at, a.end_at, a.price_rsd, a.status, a.service_id,
         c.phone_e164, s.name as service_name, t.timezone
    into v_found
  from appointments a
  join clients c on c.id = a.client_id
  join services s on s.id = a.service_id
  join tenants t on t.id = a.tenant_id
  where a.tenant_id = p_tenant_id and a.request_id = p_request_id;

  if not found then
    return null;
  end if;

  if v_found.phone_e164 <> p_phone_e164
     or v_found.service_id <> p_service_id
     or v_found.start_at <> p_start_at
     or v_found.status not in ('pending', 'confirmed') then
    return jsonb_build_object('ok', false, 'reason', 'request_conflict');
  end if;

  return jsonb_build_object(
    'ok', true,
    'replayed', true,
    'appointment', jsonb_build_object(
      'id', v_found.id,
      'tenant_id', p_tenant_id,
      'timezone', v_found.timezone,
      'start_at', v_found.start_at,
      'end_at', v_found.end_at,
      'service_name', v_found.service_name,
      'price_rsd', v_found.price_rsd
    )
  );
end;
$$;

revoke execute on function booking_replay(uuid, uuid, text, uuid, timestamptz)
  from public, anon, authenticated;

drop function public_book(text, uuid, timestamptz, text, text, text, text);

create function public_book(p_slug text, p_service_id uuid, p_start_at timestamp with time zone, p_client_name text, p_phone_e164 text, p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid)
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

  if coalesce(p_phone_e164, '') !~ '^\+381[0-9]{8,9}$'
     or phone_looks_fake(p_phone_e164) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

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
  exception when exclusion_violation or unique_violation then
    -- Dva istovremena zahteva sa istim `request_id`: gubitnik ne sme da dobije
    -- `slot_taken` za termin koji je upravo njegov.
    v_replay := booking_replay(
      v_tenant.id, p_request_id, p_phone_e164, p_service_id, p_start_at
    );

    if v_replay is not null then
      return v_replay;
    end if;

    if sqlstate <> '23P01' then
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

revoke execute on function
  public_book(text, uuid, timestamptz, text, text, text, text, uuid)
  from public, anon, authenticated;

grant execute on function
  public_book(text, uuid, timestamptz, text, text, text, text, uuid)
  to service_role;
