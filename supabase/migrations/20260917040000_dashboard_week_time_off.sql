-- Kalendar salona vraća i odsustva te nedelje.
--
-- Bez njih dan u kom je vlasnica kod lekara izgleda kao običan radni dan sa
-- praznim rasporedom: javna strana termine ne nudi, ali njen sopstveni
-- kalendar o tome ne kaže ništa. Odsustvo je upisala ona, pa u danu mora i da
-- ga vidi.
--
-- Domet bira RLS, kao i za termine: funkcija radi kao pozivalac.
create or replace function dashboard_week(
  p_date date default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
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
      from working_hours wh
      where wh.tenant_id = v_tenant.id
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
          'service_name', s.name
        )
        order by a.start_at
      )
      from appointments a
      join clients c on c.id = a.client_id
      join services s on s.id = a.service_id
      where a.tenant_id = v_tenant.id
        and a.start_at <@ v_window
    ), '[]'::jsonb),
    -- Odsustvo koje samo dodiruje nedelju izlazi celo; koji deo pada u koji
    -- dan seče ekran, jer samo on zna koji je dan izabran.
    'time_off', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'start_at', t.start_at,
          'end_at', t.end_at,
          'reason', t.reason
        )
        order by t.start_at
      )
      from time_off t
      where t.tenant_id = v_tenant.id
        and tstzrange(t.start_at, t.end_at, '[)') && v_window
    ), '[]'::jsonb)
  );
end;
$$;
