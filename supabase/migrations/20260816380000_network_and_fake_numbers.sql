-- Zaštita od lažnih zakazivanja, drugi sloj.
--
-- Kolačić uređaja hvata onoga ko dva puta zakaže iz istog pregledača. Ne hvata
-- privatni prozor, obrisane podatke, ni skriptu koja između pokušaja obriše
-- kolačić. Za to je potrebno nešto što posetilac ne bira sam.
--
-- Adresa se ne čuva. Čuva se njen heš, i to zasoljen po salonu: isti posetilac
-- u dva salona daje dva različita heša, pa se ni uz pristup bazi ne može
-- napraviti spisak toga ko je gde bio.

alter table appointment_events add column network_hash text;

comment on column appointment_events.network_hash is
  'sha256(tenant_id || adresa). Služi samo brojanju; adresa se ne čuva.';

create index appointment_events_network_hash_idx
  on appointment_events (network_hash, created_at desc)
  where network_hash is not null;

-- Trag o mreži nastaje tamo gde i trag o uređaju ---------------------------

create or replace function log_appointment_status_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type actor_type;
  v_actor_id uuid;
  v_device_id text;
  v_network text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  v_device_id := nullif(current_setting('app.device_id', true), '');
  v_network := nullif(current_setting('app.network_hash', true), '');
  v_actor_id := auth.uid();

  begin
    v_actor_type :=
      nullif(current_setting('app.actor_type', true), '')::actor_type;
  exception when invalid_text_representation then
    v_actor_type := null;
  end;

  if v_actor_type is null then
    v_actor_type := case when v_actor_id is null then 'system' else 'user' end;
  end if;

  insert into appointment_events (
    tenant_id, appointment_id, from_status, to_status,
    actor_type, actor_id, device_id, network_hash
  ) values (
    new.tenant_id,
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    v_actor_type,
    case when v_actor_type = 'user' then v_actor_id end,
    v_device_id,
    v_network
  );

  return null;
end;
$$;

-- Granice ------------------------------------------------------------------

drop function booking_limit_reason(uuid, text, timestamptz, text);

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
  -- Najviše dva termina u nedelji oko traženog datuma. Ko dolazi svake nedelje
  -- ovo ne oseti: termini od pre i posle sedam dana ne ulaze u isti prozor.
  c_week_days constant integer := 7;
  c_max_per_week constant integer := 2;

  -- Gornja granica za sve buduće termine, da se dvadeset rezervacija ne
  -- razmaže po tri meseca i tako zaobiđe nedeljni limit.
  --
  -- Ostaje četiri. Spuštanje na tri odbija stalnu mušteriju koja zakaže četiri
  -- nedelje unapred, a nijednom nije bila označena kao došla — a to je
  -- najskuplja greška koju ovaj deo može da napravi. Troll koji drži tri
  -- termina umesto četiri nije dobitak vredan te cene.
  c_max_upcoming_new constant integer := 4;
  c_max_upcoming_known constant integer := 6;

  -- Isti uređaj, bez obzira koliko je različitih brojeva upisao.
  c_max_upcoming_device constant integer := 6;
  c_cooldown_seconds constant integer := 30;

  -- Ista mreža u poslednjih sat vremena. Granica je namerno visoka: mobilni
  -- operateri dele jednu adresu na hiljade pretplatnika, pa ovo sme da hvata
  -- samo skriptu, nikad dve komšinice koje zakažu isto popodne.
  c_network_window_minutes constant integer := 60;
  c_max_per_network constant integer := 8;

  v_now timestamptz := now();
  v_known_client boolean;
  v_max_upcoming integer;
  v_count integer;
  v_last_booking timestamptz;
begin
  -- Prvo i najjeftinije: blokiran broj ne prolazi dalje.
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

  -- Ko je već dolazio nije nepoznat broj. Trenje raste sa rizikom, a ne sa
  -- brojem termina — zato stalna mušterija sme više. Broji se samo `completed`:
  -- ko nije došao ne postaje poznat.
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

  -- Izdvojeno u promenljivu namerno: `if` u plpgsql-u čita uslov do prvog
  -- `then`, pa bi `case ... then ... end` unutar uslova prekinuo izraz.
  v_max_upcoming := case
    when v_known_client then c_max_upcoming_known
    else c_max_upcoming_new
  end;

  if v_count >= v_max_upcoming then
    return 'too_many_upcoming';
  end if;

  -- Mreža pre uređaja: kolačić se briše, adresa ne.
  if p_network_hash is not null and p_network_hash <> '' then
    select count(*) into v_count
    from appointment_events e
    where e.tenant_id = p_tenant_id
      and e.network_hash = p_network_hash
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

  -- Uređaj se čita iz istorije promena, jer je red o nastanku termina
  -- (`from_status is null`) jedino mesto gde uređaj i stoji.
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

-- Zakazivanje prosleđuje i mrežu ------------------------------------------

drop function public_book(text, uuid, timestamptz, text, text, text);

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
