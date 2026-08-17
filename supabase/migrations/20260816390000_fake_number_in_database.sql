-- Izmišljen broj se odbija i u bazi, ne samo na formi.
--
-- Provera je do sada stajala jedino u `normalizePhone`, u JavaScript-u. Ko
-- pozove `public_book` direktno — a `anon` ključ i slug salona su javni —
-- zaobišao bi je celu. Pravilo projekta je da provera u kodu služi lepšoj
-- poruci, a baza brani; ovde je nedostajala druga polovina.
--
-- Ista logika, ista dva praga. Ako se jedna promeni, druga mora za njom.

create function phone_looks_fake(p_phone text) returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_subscriber text;
  v_ascending boolean := true;
  v_descending boolean := true;
  v_step integer;
begin
  -- Sve iste cifre je izmišljen broj u svakoj zemlji.
  if v_digits ~ '^(\d)\1+$' then
    return true;
  end if;

  -- Van Srbije se ne zna gde prestaje mreža a počinje pretplatnik, pa se
  -- dalje ne nagađa.
  if left(v_digits, 3) <> '381' then
    return false;
  end if;

  -- Nacionalni broj bez dve cifre mreže: iz `381645123480` ostaje `5123480`.
  v_subscriber := substr(v_digits, 6);

  if length(v_subscriber) >= 6 and v_subscriber ~ '^(\d)\1+$' then
    return true;
  end if;

  -- Sedam, ne šest: u kraćem obliku broja (`064 123 456`) pretplatnički deo
  -- ima tačno šest cifara, pa bi niz od šest odbio i stvaran broj.
  if length(v_subscriber) < 7 then
    return false;
  end if;

  for i in 2..length(v_subscriber) loop
    v_step := ascii(substr(v_subscriber, i, 1))
            - ascii(substr(v_subscriber, i - 1, 1));
    if v_step <> 1 then
      v_ascending := false;
    end if;
    if v_step <> -1 then
      v_descending := false;
    end if;
  end loop;

  return v_ascending or v_descending;
end;
$$;

revoke execute on function phone_looks_fake(text) from public, anon;

-- Javno zakazivanje ga koristi ---------------------------------------------

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

  v_limit_reason := booking_limit_reason(
    v_tenant.id, p_phone_e164, p_start_at, p_device_id, p_network_hash
  );

  if v_limit_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_limit_reason);
  end if;

  perform set_config('app.actor_type', 'client', true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);
  perform set_config('app.network_hash', coalesce(p_network_hash, ''), true);

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
