-- Drugi izvođač --------------------------------------------------------------
--
-- Do sada je svaka funkcija uzimala „prvog aktivnog izvođača" i tu se
-- zaustavljala: `order by created_at, id limit 1`. Baza je oduvek imala tabelu
-- `staff` sa više redova, ali do nje se nije moglo doći ni iz jednog ekrana.
--
-- Salon sada može da doda još jednu osobu. Svaka ima svoje radno vreme, svoja
-- odsustva i svoje usluge, a klijent bira kod koga zakazuje. Salon sa jednom
-- osobom ne vidi nijednu promenu — ni jedan korak više u zakazivanju.
--
-- Gornja granica je dvoje. To nije tehničko ograničenje nego granica
-- proizvoda: sa trećom osobom počinju smene, zamene i izveštaji po osobi, a to
-- je salonski ERP koji ovo namerno nije.

/** Izvođači salona. RLS pušta samo članove, pa ovde nema dodatne provere. */
create function tenant_staff(p_tenant_id uuid default null)
returns table (id uuid, name text, active boolean)
language sql
stable
set search_path = public
as $$
  select s.id, s.name, s.active
  from staff s
  where s.tenant_id = resolve_tenant(p_tenant_id)
  order by s.active desc, s.created_at, s.id;
$$;

revoke execute on function tenant_staff(uuid) from public, anon;
grant execute on function tenant_staff(uuid) to authenticated;

/**
 * Dodaje izvođača ili preimenuje postojećeg.
 *
 * Nov izvođač nasleđuje radno vreme i usluge od prvog. Bez toga bi ga salon
 * dodao, video ga u spisku, i ne bi mogao da mu zakaže ništa — bez radnog
 * vremena nema nijednog slobodnog termina, a bez veze sa uslugom ne izlazi na
 * javnu stranicu. Salon posle promeni ono što se razlikuje.
 */
create function set_staff(
  p_name text,
  p_staff_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_source uuid;
  v_id uuid;
  v_count int;
begin
  if v_tenant_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if v_name is null or length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if p_staff_id is not null then
    update staff set name = v_name
    where id = p_staff_id and tenant_id = v_tenant_id
    returning id into v_id;

    if v_id is null then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  select count(*) into v_count
  from staff where tenant_id = v_tenant_id and active;

  if v_count >= 2 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  select id into v_source
  from staff
  where tenant_id = v_tenant_id and active
  order by created_at, id
  limit 1;

  insert into staff (tenant_id, name)
  values (v_tenant_id, v_name)
  returning id into v_id;

  insert into staff_services (tenant_id, staff_id, service_id)
  select v_tenant_id, v_id, s.id
  from services s
  where s.tenant_id = v_tenant_id and s.active
  on conflict do nothing;

  if v_source is not null then
    insert into working_hours
      (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
    select v_tenant_id, v_id, wh.weekday, wh.start_time, wh.end_time, wh.slot_minutes
    from working_hours wh
    where wh.staff_id = v_source;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function set_staff(text, uuid, uuid) from public, anon;
grant execute on function set_staff(text, uuid, uuid) to authenticated;

/**
 * Sklanja izvođača.
 *
 * Ne briše red: termini pokazuju na njega i istorija bi ostala bez imena.
 * Poslednji aktivni se ne sme skloniti — salon bez ijednog izvođača ne može
 * primiti nijedan termin, ni sa javne strane ni ručno.
 */
create function deactivate_staff(p_staff_id uuid, p_tenant_id uuid default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_count int;
  v_id uuid;
begin
  if v_tenant_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  -- Prvo se proverava da li je osoba uopšte iz ovog salona. Obrnutim redom bi
  -- pokušaj nad tuđom osobom vratio „poslednja je" — netačno objašnjenje
  -- odbijanja koje govori i nešto o tuđem salonu.
  select id into v_id
  from staff
  where id = p_staff_id and tenant_id = v_tenant_id and active;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select count(*) into v_count
  from staff where tenant_id = v_tenant_id and active;

  if v_count <= 1 then
    return jsonb_build_object('ok', false, 'reason', 'last_one');
  end if;

  update staff set active = false where id = v_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function deactivate_staff(uuid, uuid) from public, anon;
grant execute on function deactivate_staff(uuid, uuid) to authenticated;

-- Postojeće funkcije dobijaju izvođača ----------------------------------------

drop function set_working_hours(jsonb, uuid);
drop function add_time_off(timestamptz, timestamptz, text, uuid);
drop function create_appointment(uuid, timestamptz, integer, text, text, text);
drop function public_book(text, uuid, timestamptz, text, text, text, text);

CREATE OR REPLACE FUNCTION public.set_working_hours(p_blocks jsonb, p_tenant_id uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_staff_id uuid;
begin
  -- Bez izabranog izvođača radi se o salonu sa jednom osobom; tada je izbor
  -- jednoznačan i ekran ga ni ne prikazuje.
  select id into v_staff_id
  from staff
  where tenant_id = v_tenant_id and active
    and (p_staff_id is null or id = p_staff_id)
  order by created_at, id
  limit 1;

  if v_staff_id is null then
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
$function$;

CREATE OR REPLACE FUNCTION public.add_time_off(p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_reason text DEFAULT NULL::text, p_tenant_id uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_staff_id uuid;
  v_id uuid;
begin
  if p_start_at >= p_end_at then
    return jsonb_build_object('ok', false, 'reason', 'end_before_start');
  end if;

  select id into v_staff_id
  from staff
  where tenant_id = v_tenant_id and active
    and (p_staff_id is null or id = p_staff_id)
  order by created_at, id
  limit 1;

  if v_staff_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  insert into time_off (tenant_id, staff_id, start_at, end_at, reason)
  values (
    v_tenant_id, v_staff_id, p_start_at, p_end_at,
    nullif(btrim(coalesce(p_reason, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_service(p_id uuid, p_name text, p_duration_min integer, p_price_rsd integer, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_staff_id uuid;
  v_name text;
  v_id uuid;
begin
  v_name := btrim(coalesce(p_name, ''));

  if v_name = '' or length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if p_duration_min is null or p_duration_min <= 0 or p_duration_min > 1440 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_duration');
  end if;

  if p_price_rsd is null or p_price_rsd < 0 or p_price_rsd > 10000000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_price');
  end if;

  if v_tenant_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_id is not null then
    -- Izmena mora da pogodi salon u kome se korisnik trenutno nalazi. Bez
    -- toga bi članica dva salona mogla, iz jednog, da prepravi uslugu drugog.
    update services
       set name = v_name,
           duration_min = p_duration_min,
           price_rsd = p_price_rsd
     where id = p_id and tenant_id = v_tenant_id
    returning id into v_id;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  insert into services (tenant_id, name, duration_min, price_rsd)
  values (v_tenant_id, v_name, p_duration_min, p_price_rsd)
  returning id into v_id;

  -- Bez veze sa izvođačem usluga ne bi izašla na javnu stranicu, a salon ne
  -- bi imao gde da vidi zašto.
  -- Nova usluga ide svim aktivnim izvođačima; ko je ne radi, salon je posle
  -- skine sa te osobe. Obrnuto bi značilo da nova usluga tiho ne izađe.
  insert into staff_services (tenant_id, staff_id, service_id)
  select v_tenant_id, st.id, v_id
  from staff st
  where st.tenant_id = v_tenant_id and st.active
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_appointment(p_service_id uuid, p_start_at timestamp with time zone, p_duration_min integer, p_client_name text, p_phone_e164 text, p_device_id text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  -- Bez izabranog izvođača salon ima jednu osobu i forma ga ne pita.
  select id into v_staff_id
  from staff
  where tenant_id = v_service.tenant_id and active
    and (p_staff_id is null or id = p_staff_id)
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
$function$;

CREATE OR REPLACE FUNCTION public.public_book(p_slug text, p_service_id uuid, p_start_at timestamp with time zone, p_client_name text, p_phone_e164 text, p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid)
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

  select * into v_service
  from services
  where id = p_service_id and tenant_id = v_tenant.id and active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_service');
  end if;

  -- Izabran izvođač mora da radi baš tu uslugu; adresa se lako prepravi.
  if p_staff_id is not null then
    select st.id into v_staff_id
    from staff st
    where st.id = p_staff_id and st.tenant_id = v_tenant.id and st.active
      and exists (
        select 1 from staff_services ss
        where ss.staff_id = st.id and ss.service_id = v_service.id
      );

    if v_staff_id is null then
      return jsonb_build_object('ok', false, 'reason', 'unknown_service');
    end if;
  else
    -- „Svejedno mi je": prvi ko radi tu uslugu i stvarno je slobodan tada.
    -- Traži se slobodan ovde, a ne posle, da izbor ne padne na zauzetu osobu
    -- dok je druga bila slobodna.
    select st.id into v_staff_id
    from staff st
    where st.tenant_id = v_tenant.id and st.active
      and exists (
        select 1 from staff_services ss
        where ss.staff_id = st.id and ss.service_id = v_service.id
      )
      and is_bookable_start(st.id, v_tenant.timezone, p_start_at)
      and not exists (
        select 1 from time_off t
        where t.staff_id = st.id
          and tstzrange(t.start_at, t.end_at, '[)')
              && tstzrange(p_start_at,
                   p_start_at + make_interval(mins => v_service.duration_min), '[)')
      )
      and not exists (
        select 1 from appointments ap
        where ap.staff_id = st.id
          and ap.status in ('pending', 'confirmed')
          and ap.blocked_range
              && tstzrange(p_start_at,
                   p_start_at + make_interval(mins => v_service.duration_min), '[)')
      )
    order by st.created_at, st.id
    limit 1;

    -- Niko nije slobodan: uzima se prvi ko tu uslugu radi, pa provere ispod
    -- kažu tačan razlog — van radnog vremena, odsustvo, prerano — umesto da
    -- se sve svede na „zauzeto".
    if v_staff_id is null then
      select st.id into v_staff_id
      from staff st
      where st.tenant_id = v_tenant.id and st.active
        and exists (
          select 1 from staff_services ss
          where ss.staff_id = st.id and ss.service_id = v_service.id
        )
      order by st.created_at, st.id
      limit 1;

      if v_staff_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unknown_service');
      end if;
    end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.public_booking_data(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant tenants;
  v_staff_id uuid;
  v_now timestamptz := now();
  v_from_date date;
  v_to_date date;
  v_window tstzrange;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found
     or not v_tenant.public_booking_enabled
     or v_tenant.suspended_at is not null
     or subscription_expired(v_tenant.paid_until, v_tenant.timezone) then
    return null;
  end if;

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
      'min_lead_minutes', v_tenant.min_lead_minutes,
      'brand_background', v_tenant.brand_background,
      'brand_primary', v_tenant.brand_primary,
      'brand_accent', v_tenant.brand_accent,
      'logo_url', v_tenant.logo_url
    ),
    'now', v_now,
    'from_date', v_from_date,
    'to_date', v_to_date,
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'duration_min', s.duration_min,
          'price_rsd', s.price_rsd
        )
        order by s.name
      )
      from services s
      where s.tenant_id = v_tenant.id
        and s.active
        and exists (
          select 1
          from staff_services ss
          join staff st on st.id = ss.staff_id and st.active
          where ss.service_id = s.id and st.tenant_id = v_tenant.id
        )
    ), '[]'::jsonb),
    -- Svaka osoba nosi svoje radno vreme, svoju zauzetost i spisak usluga
    -- koje radi. Salon sa jednom osobom dobije niz od jednog reda i strana
    -- ne prikaže nijedan korak više nego do sada.
    'staff', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', st.id,
          'name', st.name,
          'service_ids', coalesce((
            select jsonb_agg(ss.service_id)
            from staff_services ss
            join services sv on sv.id = ss.service_id and sv.active
            where ss.staff_id = st.id
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
            where wh.staff_id = st.id
          ), '[]'::jsonb),
          'busy', coalesce((
            select jsonb_agg(
              jsonb_build_object('start_at', taken.start_at, 'end_at', taken.end_at)
              order by taken.start_at
            )
            from (
              select lower(a.blocked_range) as start_at, upper(a.blocked_range) as end_at
              from appointments a
              where a.staff_id = st.id
                and a.status in ('pending', 'confirmed')
                and a.blocked_range && v_window
              union all
              select t.start_at, t.end_at
              from time_off t
              where t.staff_id = st.id
                and tstzrange(t.start_at, t.end_at, '[)') && v_window
            ) taken
          ), '[]'::jsonb)
        )
        order by st.created_at, st.id
      )
      from staff st
      where st.tenant_id = v_tenant.id and st.active
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_week(p_date date DEFAULT NULL::date, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_tenant tenants;
  v_today date;
  v_monday date;
  v_window tstzrange;
begin
  select * into v_tenant from tenants where id = resolve_tenant(p_tenant_id);

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
      'public_booking_enabled', v_tenant.public_booking_enabled,
      'suspended', v_tenant.suspended_at is not null,
      'paid_until', v_tenant.paid_until
    ),
    -- Spisak salona putuje uz kalendar: prebacivanje u zaglavlju ne sme da
    -- košta još jedan odlazak do baze na svakom otvaranju strane.
    'tenants', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name)
        order by t.created_at
      )
      from tenants t
    ), '[]'::jsonb),
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
      from (
        -- Dve osobe sa istim radnim vremenom dale bi dva ista bloka, pa bi
        -- dan u kalendaru bio iscrtan dvaput.
        select distinct weekday, start_time, end_time, slot_minutes
        from working_hours
        where tenant_id = v_tenant.id
      ) wh
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', st.id, 'name', st.name)
        order by st.created_at, st.id
      )
      from staff st
      where st.tenant_id = v_tenant.id and st.active
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
          'service_name', s.name,
          'staff_id', a.staff_id,
          'staff_name', st.name
        )
        order by a.start_at
      )
      from appointments a
      join clients c on c.id = a.client_id
      join services s on s.id = a.service_id
      join staff st on st.id = a.staff_id
      where a.tenant_id = v_tenant.id
        and a.start_at <@ v_window
    ), '[]'::jsonb)
  );
end;
$function$;

-- Prava ---------------------------------------------------------------------

revoke execute on function set_working_hours(jsonb, uuid, uuid) from public, anon;
grant execute on function set_working_hours(jsonb, uuid, uuid) to authenticated;

revoke execute on function add_time_off(timestamptz, timestamptz, text, uuid, uuid) from public, anon;
grant execute on function add_time_off(timestamptz, timestamptz, text, uuid, uuid) to authenticated;

revoke execute on function create_appointment(uuid, timestamptz, integer, text, text, text, uuid) from public, anon;
grant execute on function create_appointment(uuid, timestamptz, integer, text, text, text, uuid) to authenticated;

revoke execute on function public_book(text, uuid, timestamptz, text, text, text, text, uuid) from public;
grant execute on function public_book(text, uuid, timestamptz, text, text, text, text, uuid) to anon, authenticated;
