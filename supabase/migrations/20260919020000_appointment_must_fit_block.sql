-- Termin ne sme da pregazi pauzu ni kraj smene ------------------------------
--
-- Blok je do sada značio samo „kad se počinje": usluga od sat i po koja krene
-- u 11:30 u smeni do 12 završavala bi u 13, dakle pola sata u pauzi. Salon
-- koji je podesio dva termina pre podne dobijao je treći, i to preko pauze.
--
-- Sada kraj usluge sme da pređe kraj bloka najviše petnaest minuta. Pauza u
-- 12 znači da se radi najkasnije do 12:15; smena do 20 znači da usluga sme da
-- traje najkasnije do 20:15.
--
-- Isti broj stoji u `lib/domain/availability.ts`. Motor time ne ponudi takav
-- termin, a ovo ga ne pusti da se upiše ni ako se ponuda zaobiđe.
--
-- Vlasničin sopstveni upis (`create_appointment`) ovo ne dodiruje: njen
-- kalendar je njen i termin van radnog vremena tamo i dalje prolazi.

drop function if exists is_bookable_start(uuid, text, timestamptz);

create function is_bookable_start(
  p_staff_id uuid,
  p_timezone text,
  p_start_at timestamptz,
  p_duration_min int
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
      -- Petnaest minuta tolerancije preko kraja bloka.
      and p_start_at + make_interval(mins => p_duration_min)
            <= b.closes + interval '15 minutes'
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
          from time_off t
          where t.staff_id = p_staff_id
            and t.end_at = p_start_at
        )
      )
  )
$$;

revoke execute on function is_bookable_start(uuid, text, timestamptz, int)
  from public, anon, authenticated;

-- `public_book` prosleđuje trajanje usluge ------------------------------------

CREATE OR REPLACE FUNCTION public.public_book(p_slug text, p_service_id uuid, p_start_at timestamp with time zone, p_client_name text, p_phone_e164 text, p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
