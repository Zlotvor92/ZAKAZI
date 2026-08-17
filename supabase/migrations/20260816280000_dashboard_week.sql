-- Sve što kalendaru treba za jednu nedelju, u jednom pozivu.
--
-- Salon, radno vreme i termini su ranije bili tri odvojena poziva, a drugi je
-- morao da čeka prvi jer raspon zavisi od tajmzone salona. Na malom serveru
-- svaki poziv nosi svojih pedeset do sto milisekundi pre nego što Postgres
-- išta uradi, pa je taj red skuplji od svog rada.
--
-- Ponedeljak nedelje računa baza i vraća ga nazad, da aplikacija filtrira dane
-- po istoj granici po kojoj su termini i birani.
--
-- Bez `security definer`: RLS bira i salon i radno vreme i termine.
create function dashboard_week(p_date date default null) returns jsonb
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
  select * into v_tenant from tenants order by created_at limit 1;

  if not found then
    return null;
  end if;

  v_today := (now() at time zone v_tenant.timezone)::date;
  -- `date_trunc('week', …)` u Postgresu počinje ponedeljkom, isto kao ISO.
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
      'public_booking_enabled', v_tenant.public_booking_enabled
    ),
    'today', v_today,
    'week_start', v_monday,
    'working_hours', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', wh.weekday,
          'start_minute', (extract(epoch from wh.start_time) / 60)::int,
          'end_minute', (extract(epoch from wh.end_time) / 60)::int
        )
        order by wh.weekday, wh.start_time
      )
      from working_hours wh
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
          'buffer_after_min', a.buffer_after_min,
          'client_name', c.name,
          'client_phone', c.phone_e164,
          'service_name', s.name
        )
        order by a.start_at
      )
      from appointments a
      join clients c on c.id = a.client_id
      join services s on s.id = a.service_id
      where a.start_at <@ v_window
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function dashboard_week(date) from public, anon;
grant execute on function dashboard_week(date) to authenticated;

-- Zamenjuje `dashboard_appointments`, koja je vraćala samo termine i tražila
-- da pozivalac unapred zna tajmzonu salona.
drop function dashboard_appointments(timestamptz, timestamptz);
