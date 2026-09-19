-- Salon sam bira koliko termin sme da pređe ---------------------------------
--
-- Petnaest minuta je bio moj broj, ne njihov. Kozmetičarka koja radi sat i po
-- po klijentu i ima pauzu od sat vremena mirno pušta pola sata preko; ona sa
-- pauzom od dvadeset minuta ne pušta ništa. Zato su to sada dva podešavanja,
-- i namerno odvojena: ulazak u pauzu i ostajanje posle kraja radnog dana nisu
-- ista odluka. Pauza se skraćuje, a posle posla se ostaje.
--
-- Trideset minuta je podrazumevano, jer je to broj koji je tražen kad se
-- videlo kako petnaest radi u salonu.

alter table tenants
  add column break_overrun_min int not null default 30,
  add column shift_overrun_min int not null default 30,
  add constraint tenants_overrun_range check (
    break_overrun_min between 0 and 120
    and shift_overrun_min between 0 and 120
  );

-- Prava se daju po koloni, pa nova kolona ne nasleđuje ništa.
grant select (break_overrun_min, shift_overrun_min) on tenants to authenticated;
grant update (break_overrun_min, shift_overrun_min) on tenants to authenticated;

/**
 * Kraj bloka posle kog istog dana sledi još rada je početak pauze; kraj
 * poslednjeg bloka je kraj radnog dana. Za svaki važi svoje ograničenje.
 */
create or replace function is_bookable_start(
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
    from working_hours wh
    join tenants t on t.id = wh.tenant_id,
    lateral (
      select (p_start_at at time zone p_timezone)::date as local_date
    ) d,
    lateral (
      select (d.local_date + wh.start_time) at time zone p_timezone as opens,
             (d.local_date + wh.end_time) at time zone p_timezone as closes,
             exists (
               select 1
               from working_hours w2
               where w2.staff_id = wh.staff_id
                 and w2.weekday = wh.weekday
                 and w2.start_time > wh.start_time
             ) as break_follows
    ) b
    where wh.staff_id = p_staff_id
      and wh.weekday = extract(isodow from d.local_date)
      and p_start_at >= b.opens
      and p_start_at < b.closes
      and p_start_at + make_interval(mins => p_duration_min)
            <= b.closes + make_interval(
                 mins => case when b.break_follows
                              then t.break_overrun_min
                              else t.shift_overrun_min
                         end
               )
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
          from time_off t2
          where t2.staff_id = p_staff_id
            and t2.end_at = p_start_at
        )
      )
  )
$$;

-- `public_booking_data`: javna strana dobija oba ograničenja ------------------

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
          'price_rsd', s.price_rsd
        )
        order by s.name
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
