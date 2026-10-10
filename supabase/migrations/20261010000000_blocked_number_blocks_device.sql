-- Blokiran broj blokira i uređaj sa kog je zakazivao.
--
-- Bez nove tabele i bez ekrana: pravilo se izvodi iz podataka koji već
-- postoje. Odblokiranje broja odblokira i uređaj. Isto telo funkcije kao u
-- `20261009010000_late_cancel_pardon.sql`; dodat je samo blok sa uređajem.

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

  -- Uređaj sa kog je blokiran broj sam zakazivao je blokiran isto, da se
  -- zaobilaženje ne svodi na upis drugog broja. Gledaju se samo događaji
  -- nastanka termina koje je napravio klijent; uređaj salona ne ulazi.
  -- Izuzet broj je ispred ovog pravila: salon mu veruje.
  if p_device_id is not null and p_device_id <> '' and exists (
    select 1
    from appointment_events e
    join appointments a on a.tenant_id = e.tenant_id and a.id = e.appointment_id
    join clients c on c.tenant_id = a.tenant_id and c.id = a.client_id
    join blocklist b on b.tenant_id = c.tenant_id and b.phone_e164 = c.phone_e164
    where e.tenant_id = p_tenant_id
      and e.device_id = p_device_id
      and e.actor_type = 'client'
      and e.from_status is null
  ) then
    return 'blocked';
  end if;

  if late_cancellation_count(p_tenant_id, p_phone_e164) >= late_cancel_limit() then
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
