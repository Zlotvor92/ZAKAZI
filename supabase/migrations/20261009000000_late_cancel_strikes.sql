-- Kasno otkazivanje se ne zabranjuje, nego se broji --------------------------
--
-- `20261008060000_cancel_24h_before.sql` je preko sajta zabranio otkazivanje
-- manje od 24 sata pre termina. Ovo to skida: klijentkinja može da otkaže u
-- svako doba, ali otkazivanje manje od 24 sata pre početka je „kasno", i posle
-- dva takva u istom salonu sajt više ne dozvoljava da sama zakaže (razlog
-- `too_many_late_cancellations`), nego je šalje salonu.
--
-- Brojač se ne čuva u novoj koloni. Izvodi se iz `appointment_events`: otkazivanje
-- koje je pokrenula klijentkinja (`actor_type = 'client'`) čiji je termin počinjao
-- manje od 24 sata posle trenutka događaja. Audit log je nepromenljiv, pa ni
-- salon ni greška u kodu ne mogu da „isprave" brojač, a pravilo i dokaz su isti
-- red. Isti prag kao ranije: `start_at < trenutak + 24 sata`.
--
-- Računa se samo otkazivanje preko sajta. Salon koji u kalendaru označi termin
-- kao „otkazala klijentkinja" ne dodaje ništa: to je njegova odluka, a
-- zabeležena pogreška u kalendaru ne bi mogla da se poništi.
--
-- Brojač je po salonu i po broju telefona, bez isteka. Izuzeti brojevi
-- (`limit_exempt_phones`) ga preskaču kao i ostala ograničenja; blokirani brojevi
-- ostaju blokirani pre svega. Salon i dalje upisuje termin ručno iz kalendara
-- (ne ide kroz `booking_limit_reason`), pa „javi se salonu" ima kome da se javi.
--
-- Spisak termina umesto `cancellable` vraća `late`, da ekran može da upozori
-- pre nego što klijentkinja dodirne „Otkaži" na termin koji će se računati.

create or replace function public_appointments_for_proof(p_slug text, p_phone_e164 text, p_secrets text[], p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant tenants;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'start_at', a.start_at,
        'end_at', a.end_at,
        'service_name', s.name,
        'price_rsd', a.price_rsd,
        'late', a.start_at < now() + interval '24 hours'
      )
      order by a.start_at
    )
    from appointments a
    join services s on s.id = a.service_id
    where a.tenant_id = v_tenant.id
      and a.id in (
        select owned_appointment_ids(v_tenant.id, p_phone_e164, p_secrets, p_device_id)
      )
      and a.status in ('pending', 'confirmed')
      and a.start_at >= now()
  ), '[]'::jsonb);
end;
$$;

-- Isto kao u `20261008060000_cancel_24h_before.sql`, bez provere `too_late`.
create or replace function public_cancel_appointment(p_slug text, p_phone_e164 text, p_appointment_id uuid, p_secrets text[], p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text)
 RETURNS jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_cancellations_per_day constant integer := 3;

  v_tenant tenants;
  v_from appointment_status;
  v_client_name text;
  v_service_name text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_network_hash text;
  v_cancelled_today integer;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+381[1-9][0-9]{7,8}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  if not exists (
    select 1
    from owned_appointment_ids(
      v_tenant.id, p_phone_e164, p_secrets, p_device_id
    ) as owned
    where owned = p_appointment_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_network_hash := effective_network_hash(v_tenant.id, p_network_hash);

  -- Isti advisory lock kao u `public_book`: dva istovremena otkazivanja istog
  -- broja ne smeju oba da vide „dva do sada" i prođu.
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant.id::text || ':' || p_phone_e164, 0)
  );

  -- `for update` da dupli dodir na dugme ili dve kartice ne bi otkazale isti
  -- termin dvaput sa dva različita ishoda u audit logu.
  select a.status, a.start_at, a.end_at, c.name, s.name
    into v_from, v_start_at, v_end_at, v_client_name, v_service_name
  from appointments a
  join clients c on c.id = a.client_id
  join services s on s.id = a.service_id
  where a.id = p_appointment_id
    and a.tenant_id = v_tenant.id
  for update of a;

  if v_from in ('cancelled_by_client', 'cancelled_by_salon') then
    return jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  end if;

  if not appointment_status_allowed(v_from, 'cancelled_by_client') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;

  if not exists (
    select 1 from limit_exempt_phones x
    where x.tenant_id = v_tenant.id and x.phone_e164 = p_phone_e164
  ) then
    select count(*) into v_cancelled_today
    from appointment_events e
    join appointments a
      on a.tenant_id = e.tenant_id and a.id = e.appointment_id
    join clients c on c.id = a.client_id
    where e.tenant_id = v_tenant.id
      and c.phone_e164 = p_phone_e164
      and e.actor_type = 'client'
      and e.to_status = 'cancelled_by_client'
      and e.created_at >= now() - interval '24 hours';

    if v_cancelled_today >= c_max_cancellations_per_day then
      return jsonb_build_object('ok', false, 'reason', 'too_many_cancellations');
    end if;
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

-- `booking_limit_reason`: isto telo kao u `20260927010000_limit_exempt_phones.sql`,
-- novo je samo brojanje kasnih otkazivanja posle provere izuzetih brojeva.

CREATE OR REPLACE FUNCTION public.booking_limit_reason(p_tenant_id uuid, p_phone_e164 text, p_start_at timestamp with time zone, p_device_id text, p_network_hash text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_week_days constant integer := 7;
  c_max_per_week constant integer := 2;
  c_max_upcoming_new constant integer := 4;
  c_max_upcoming_known constant integer := 6;
  c_max_upcoming_device constant integer := 6;
  c_cooldown_seconds constant integer := 30;
  c_network_window_minutes constant integer := 60;
  c_max_per_network constant integer := 8;
  c_max_late_cancellations constant integer := 2;

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

  if exists (
    select 1 from limit_exempt_phones x
    where x.tenant_id = p_tenant_id and x.phone_e164 = p_phone_e164
  ) then
    return null;
  end if;

  select count(*) into v_count
  from appointment_events e
  join appointments a
    on a.tenant_id = e.tenant_id and a.id = e.appointment_id
  join clients c on c.id = a.client_id
  where e.tenant_id = p_tenant_id
    and c.phone_e164 = p_phone_e164
    and e.actor_type = 'client'
    and e.to_status = 'cancelled_by_client'
    and a.start_at < e.created_at + interval '24 hours';

  if v_count >= c_max_late_cancellations then
    return 'too_many_late_cancellations';
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
$function$;
