-- Salon više ne bira boje svoje stranice -------------------------------------
--
-- Izbor boja je postojao da bi stranica ličila na salon. Ispalo je suprotno:
-- svaki salon je dobijao drugačiju stranicu, pa aplikacija nije imala izgled
-- koji se prepoznaje, a nijedan salon nije dobio ništa što logo već ne radi.
-- Ostaje jedan izgled za sve i logo salona na vrhu.
--
-- Kolone se brišu, ne ostavljaju prazne: vrednost koju niko ne čita je mrtav
-- podatak koji sledeći čitalac šeme mora da razume. Boje koje je neki salon
-- upisao nestaju — to je cena skidanja funkcije i nema je drugačije.

drop function if exists set_tenant_brand(uuid, text, text, text);

create or replace function public_salon_summary(p_slug text) returns jsonb
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

  return jsonb_build_object(
    'name', v_tenant.name,
    'slug', v_tenant.slug,
    'timezone', v_tenant.timezone,
    'logo_url', v_tenant.logo_url
  );
end;
$$;

create or replace function public_booking_data(p_slug text) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
$$;

alter table tenants
  drop constraint tenants_brand_format,
  drop column brand_background,
  drop column brand_primary,
  drop column brand_accent;
