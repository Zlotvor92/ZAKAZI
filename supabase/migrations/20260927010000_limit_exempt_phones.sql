-- Brojevi bez ograničenja zakazivanja i otkazivanja ------------------------
--
-- Vlasnik platforme proverava nova pravila sa svog telefona na pravom
-- salonu. Ograničenja protiv zloupotrebe (dva termina nedeljno, pola minuta
-- između zakazivanja, broj pokušaja sa iste mreže) ga posle par proba
-- zaključaju, a obaranje ograničenja za sve nije rešenje.
--
-- Izuzetak važi po salonu i samo za ograničenja: blokiran broj ostaje
-- blokiran, a pravila usluga (rok od N dana, „ne može posle") važe kao za
-- svakoga — upravo njih se i proverava.
--
-- Spisak se puni ručno, kroz bazu. Uz uključen RLS bez ijedne politike kroz
-- API ga ne vidi niko, ni vlasnica salona.

create table limit_exempt_phones (
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+381[0-9]{8,9}$'),
  note text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone_e164)
);

alter table limit_exempt_phones enable row level security;
revoke all on limit_exempt_phones from public, anon, authenticated;

-- `booking_limit_reason`: isto telo, novo je samo preskakanje posle blokade.

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

-- `phone_lookup_limit_reason` dobija broj, da izuzet broj ne zaključa
-- pretraga sa iste mreže. Bez broja (stari poziv) radi kao do sada.

drop function phone_lookup_limit_reason(uuid, text);

create function phone_lookup_limit_reason(
  p_tenant_id uuid,
  p_network_hash text,
  p_phone_e164 text default null
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_window_minutes constant integer := 60;
  c_max_per_network constant integer := 20;
  v_count integer;
begin
  -- Nema ni klijentovu ni Kong-ovu adresu: nema šta da se broji, pa se ne
  -- rizikuje da se stalna mušterija odbije zbog tuđih pokušaja.
  if p_network_hash is null then
    return null;
  end if;

  if exists (
    select 1 from limit_exempt_phones x
    where x.tenant_id = p_tenant_id and x.phone_e164 = p_phone_e164
  ) then
    return null;
  end if;

  select count(*) into v_count
  from phone_lookup_attempts
  where tenant_id = p_tenant_id
    and network_hash = p_network_hash
    and created_at >= now() - make_interval(mins => c_window_minutes);

  if v_count >= c_max_per_network then
    return 'too_many_lookups';
  end if;

  return null;
end;
$$;

-- Zovu je samo funkcije koje rade kao vlasnik (vidi 20260925000000).
revoke execute on function phone_lookup_limit_reason(uuid, text, text)
  from public, anon, authenticated;

-- Pozivaoci šalju broj; ostatak tela je nepromenjen.

CREATE OR REPLACE FUNCTION public.public_appointments_for_phone(p_slug text, p_phone_e164 text, p_network_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant tenants;
  v_network_hash text;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return null;
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+381[0-9]{8,9}$' then
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
$function$;

CREATE OR REPLACE FUNCTION public.public_cancel_appointment(p_slug text, p_phone_e164 text, p_appointment_id uuid, p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if coalesce(p_phone_e164, '') !~ '^\+381[0-9]{8,9}$' then
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
$function$;
