-- Opis usluge -----------------------------------------------------------------
--
-- Salon mora da ume da kaže klijentkinji ono što naziv ne kaže: „korekcija
-- važi do 21 dan od prethodnog dolaska, posle toga se radi nov set". Bez toga
-- klijentkinja zakaže korekciju, a na stolici se ispostavi da treba nov set
-- koji traje pola sata duže i pomera sve posle nje.
--
-- Opis je neobavezan i kratak: vidi se na telefonu, ispod naziva usluge.

alter table services
  add column description text,
  add constraint services_description_length
    check (description is null or length(description) <= 300);

drop function upsert_service(uuid, text, integer, integer, uuid);

create function upsert_service(
  p_id uuid,
  p_name text,
  p_duration_min integer,
  p_price_rsd integer,
  p_tenant_id uuid default null,
  p_description text default null
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

  if v_tenant_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_id is not null then
    -- Izmena mora da pogodi salon u kome se korisnik trenutno nalazi. Bez
    -- toga bi članica dva salona mogla, iz jednog, da prepravi uslugu drugog.
    update services
       set name = v_name,
           duration_min = p_duration_min,
           price_rsd = p_price_rsd,
           description = v_description
     where id = p_id and tenant_id = v_tenant_id
    returning id into v_id;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  insert into services (tenant_id, name, duration_min, price_rsd, description)
  values (v_tenant_id, v_name, p_duration_min, p_price_rsd, v_description)
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

revoke execute on function upsert_service(uuid, text, integer, integer, uuid, text)
  from public, anon;
grant execute on function upsert_service(uuid, text, integer, integer, uuid, text)
  to authenticated;


drop function tenant_services(uuid);

create function tenant_services(p_tenant_id uuid default null) returns table (
  id uuid,
  name text,
  duration_min integer,
  price_rsd integer,
  description text
)
language sql
stable
set search_path = public
as $$
  select s.id, s.name, s.duration_min, s.price_rsd, s.description
  from services s
  where s.tenant_id = resolve_tenant(p_tenant_id) and s.active
  order by s.sort_order, s.name
$$;

revoke execute on function tenant_services(uuid) from public, anon;
grant execute on function tenant_services(uuid) to authenticated;

-- `public_booking_data`: opis ide na javnu stranu ---------------------------

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

  v_staff_id := booking_staff_id(v_tenant.id);

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
      'break_overrun_min', v_tenant.break_overrun_min,
      'shift_overrun_min', v_tenant.shift_overrun_min,
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
          'price_rsd', s.price_rsd,
          'description', s.description
        )
        order by s.sort_order, s.name
      )
      from services s
      where s.tenant_id = v_tenant.id
        and s.active
        and exists (
          select 1 from staff_services ss
          where ss.staff_id = v_staff_id and ss.service_id = s.id
        )
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
      where wh.staff_id = v_staff_id
    ), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(
        jsonb_build_object('start_at', taken.start_at, 'end_at', taken.end_at)
        order by taken.start_at
      )
      from (
        select lower(a.blocked_range) as start_at, upper(a.blocked_range) as end_at
        from appointments a
        where a.staff_id = v_staff_id
          and a.status in ('pending', 'confirmed')
          and a.blocked_range && v_window
        union all
        select t.start_at, t.end_at
        from time_off t
        where t.staff_id = v_staff_id
          and tstzrange(t.start_at, t.end_at, '[)') && v_window
      ) taken
    ), '[]'::jsonb)
  );
end;
$function$;
