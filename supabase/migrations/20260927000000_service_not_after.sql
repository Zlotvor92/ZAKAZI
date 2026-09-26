-- Usluga koja ne može posle druge ---------------------------------------------
--
-- Posle skidanja trepavica nema šta da se koriguje: sledeći dolazak je nov
-- set, pola sata duži od korekcije, i sve posle te klijentkinje kasni.
-- Klijentkinja to ne zna i zakaže korekciju — ponekad pre, ponekad posle
-- skidanja, u istom minutu.
--
-- Pravilo se podešava na korekciji: „ne može posle [skidanja]". Skidanje
-- važi dok ga ne pokrije nov dolazak na uslugu iz „samo posle" (nadogradnja),
-- pa pravilo bez te usluge nema dejstvo — bez nje nema čime se skidanje
-- zatvara, i jedno skidanje bi zauvek zaključalo korekciju.
--
-- Proverava se u oba smera, jer redosled rezervacija ne prati redosled
-- dolazaka:
--   * korekcija, a pre nje (obavljeno ili zakazano) skidanje bez nadogradnje
--     između — `kind = 'after'`;
--   * skidanje, a posle njega već zakazana korekcija bez nadogradnje između
--     — `kind = 'before'`.
--
-- Za razliku od roka od 21 dan, ovo važi i za broj koji salon ranije nije
-- video: skidanje je već u sistemu, pa dokaz postoji.
--
-- Javna strana odbija, vlasnica dobija upozorenje.

alter table services
  add column not_after_service_id uuid,
  add constraint services_not_after_not_self check (not_after_service_id <> id),
  add constraint services_not_after_service_fkey
    foreign key (tenant_id, not_after_service_id)
    references services (tenant_id, id) on delete set null (not_after_service_id);

/*
 * `null` kad je zakazivanje u redu, inače razlog sa podacima za poruku.
 *
 * Bez `security definer`, isto kao `service_window_problem`: iz `public_book`
 * radi kao vlasnik te funkcije, a vlasnici RLS ne da tuđi salon.
 */
create function service_sequence_problem(
  p_service_id uuid,
  p_phone_e164 text,
  p_tenant_id uuid,
  p_start_at timestamptz
) returns jsonb
language sql
stable
set search_path = public
as $$
  with client as (
    select c.id
    from clients c
    where c.tenant_id = p_tenant_id and c.phone_e164 = p_phone_e164
  ),
  visits as (
    select a.service_id, a.start_at
    from appointments a
    join client on client.id = a.client_id
    where a.tenant_id = p_tenant_id
      and a.status in ('completed', 'confirmed')
  ),
  after_blocker as (
    select jsonb_build_object(
      'kind', 'after',
      'service_name', s.name,
      'blocking_service_name', b.name,
      'blocking_at', last_b.start_at,
      'required_service_name', r.name
    ) as problem
    from services s
    join services b on b.id = s.not_after_service_id
    join services r on r.id = s.requires_service_id
    cross join lateral (
      select max(v.start_at) as start_at
      from visits v
      where v.service_id = b.id and v.start_at < p_start_at
    ) last_b
    where s.id = p_service_id
      and s.tenant_id = p_tenant_id
      and last_b.start_at is not null
      and not exists (
        select 1 from visits v
        where v.service_id = r.id
          and v.start_at > last_b.start_at
          and v.start_at < p_start_at
      )
  ),
  before_blocked as (
    select jsonb_build_object(
      'kind', 'before',
      'service_name', b.name,
      'later_service_name', s.name,
      'later_at', later.start_at
    ) as problem
    from services b
    join services s
      on s.tenant_id = b.tenant_id and s.not_after_service_id = b.id
    join services r on r.id = s.requires_service_id
    join visits later
      on later.service_id = s.id and later.start_at > p_start_at
    where b.id = p_service_id
      and b.tenant_id = p_tenant_id
      and not exists (
        select 1 from visits v
        where v.service_id = r.id
          and v.start_at > p_start_at
          and v.start_at < later.start_at
      )
    order by later.start_at
    limit 1
  )
  select problem from after_blocker
  union all
  select problem from before_blocked
  limit 1
$$;

revoke execute on function service_sequence_problem(uuid, text, uuid, timestamptz)
  from public, anon;
grant execute on function service_sequence_problem(uuid, text, uuid, timestamptz)
  to authenticated;

drop function upsert_service(uuid, text, integer, integer, uuid, text, uuid, integer);

create function upsert_service(
  p_id uuid,
  p_name text,
  p_duration_min integer,
  p_price_rsd integer,
  p_tenant_id uuid default null,
  p_description text default null,
  p_requires_service_id uuid default null,
  p_requires_within_days integer default null,
  p_not_after_service_id uuid default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_staff_id uuid;
  v_name text;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
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

  if length(v_description) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_description');
  end if;

  if (p_requires_service_id is null) <> (p_requires_within_days is null)
     or p_requires_within_days not between 1 and 365
     or p_requires_service_id = p_id then
    return jsonb_build_object('ok', false, 'reason', 'invalid_window');
  end if;

  -- Bez „samo posle" nema usluge koja zatvara skidanje (vidi zaglavlje).
  if p_not_after_service_id is not null and (
       p_requires_service_id is null
       or p_not_after_service_id = p_id
       or p_not_after_service_id = p_requires_service_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_not_after');
  end if;

  if v_tenant_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_requires_service_id is not null and not exists (
    select 1 from services
    where id = p_requires_service_id and tenant_id = v_tenant_id and active
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_window');
  end if;

  if p_not_after_service_id is not null and not exists (
    select 1 from services
    where id = p_not_after_service_id and tenant_id = v_tenant_id and active
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_not_after');
  end if;

  if p_id is not null then
    -- Izmena mora da pogodi salon u kome se korisnik trenutno nalazi. Bez
    -- toga bi članica dva salona mogla, iz jednog, da prepravi uslugu drugog.
    update services
       set name = v_name,
           duration_min = p_duration_min,
           price_rsd = p_price_rsd,
           description = v_description,
           requires_service_id = p_requires_service_id,
           requires_within_days = p_requires_within_days,
           not_after_service_id = p_not_after_service_id
     where id = p_id and tenant_id = v_tenant_id
    returning id into v_id;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  insert into services (
    tenant_id, name, duration_min, price_rsd, description,
    requires_service_id, requires_within_days, not_after_service_id
  )
  values (
    v_tenant_id, v_name, p_duration_min, p_price_rsd, v_description,
    p_requires_service_id, p_requires_within_days, p_not_after_service_id
  )
  returning id into v_id;

  -- Bez veze sa izvođačem usluga ne bi izašla na javnu stranicu, a salon ne
  -- bi imao gde da vidi zašto.
  select id into v_staff_id
  from staff
  where tenant_id = v_tenant_id and active
  order by created_at, id
  limit 1;

  if v_staff_id is not null then
    insert into staff_services (tenant_id, staff_id, service_id)
    values (v_tenant_id, v_staff_id, v_id)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function upsert_service(uuid, text, integer, integer, uuid, text, uuid, integer, uuid)
  from public, anon;
grant execute on function upsert_service(uuid, text, integer, integer, uuid, text, uuid, integer, uuid)
  to authenticated;

drop function tenant_services(uuid);

create function tenant_services(p_tenant_id uuid default null) returns table (
  id uuid,
  name text,
  duration_min integer,
  price_rsd integer,
  description text,
  requires_service_id uuid,
  requires_within_days integer,
  not_after_service_id uuid
)
language sql
stable
set search_path = public
as $$
  select s.id, s.name, s.duration_min, s.price_rsd, s.description,
         s.requires_service_id, s.requires_within_days, s.not_after_service_id
  from services s
  where s.tenant_id = resolve_tenant(p_tenant_id) and s.active
  order by s.sort_order, s.name
$$;

revoke execute on function tenant_services(uuid) from public, anon;
grant execute on function tenant_services(uuid) to authenticated;

-- `public_book`: pravilo važi i za javnu stranu ------------------------------

CREATE OR REPLACE FUNCTION public.public_book(p_slug text, p_service_id uuid, p_start_at timestamp with time zone, p_client_name text, p_phone_e164 text, p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
