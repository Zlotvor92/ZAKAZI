-- Do kog dana je pretplata plaćena.
--
-- Ovo NIJE sistem naplate. Nema plana, nema iznosa, nema automatske
-- suspenzije — evidenciju vodi vlasnik platforme ručno, a pauzu i dalje
-- pritiska sam. Jedina svrha je da se ne oslanja na pamćenje: konzola
-- izdiže salone kojima je isteklo, a vlasnica vidi upozorenje pre nego što
-- joj se link ugasi.
--
-- `null` znači da se salonu ne naplaćuje (probni period), pa se ni upozorenje
-- ne prikazuje. Dok se naplata ne uvede, kolona stoji prazna i ništa ne menja.

alter table tenants add column paid_until date;

comment on column tenants.paid_until is
  'Do kog dana je pretplata plaćena. NULL = ne naplaćuje se. Ništa se ne gasi automatski.';

create function set_tenant_paid_until(p_tenant_id uuid, p_paid_until date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_owner() then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  update tenants set paid_until = p_paid_until where id = p_tenant_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function set_tenant_paid_until(uuid, date) from public, anon;
grant execute on function set_tenant_paid_until(uuid, date) to authenticated;

-- Konzola: datum uz salon, i redosled koji izdiže ono što traži potez ------

-- `create or replace` ne ume da promeni tip povratka funkcije koja vraća skup
-- redova, a ovde se dodaje kolona — zato prvo brisanje.
drop function admin_salons();

create function admin_salons()
 RETURNS TABLE(id uuid, slug text, name text, suspended boolean, owner_email text, logo_url text, created_at timestamp with time zone, services_count integer, upcoming_count integer, last_booking_at timestamp with time zone, paid_until date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    t.id,
    t.slug,
    t.name,
    t.suspended_at is not null,
    (
      select u.email::text
      from memberships m
      join auth.users u on u.id = m.user_id
      where m.tenant_id = t.id
        and m.role = 'owner'
      order by
        exists (select 1 from platform_owners po where po.user_id = m.user_id),
        m.created_at
      limit 1
    ),
    t.logo_url,
    t.created_at,
    (select count(*)::int from services s
      where s.tenant_id = t.id and s.active),
    (select count(*)::int from appointments a
      where a.tenant_id = t.id
        and a.status in ('pending', 'confirmed')
        and a.start_at >= now()),
    (select max(a.created_at) from appointments a where a.tenant_id = t.id),
    t.paid_until
  from tenants t
  where is_platform_owner()
  -- Isteklo prvo, pa ono što ističe najskorije. Saloni bez datuma (probni
  -- period) idu na dno: kod njih nema šta da se naplati.
  order by (t.paid_until is null), t.paid_until, t.created_at
$function$;

revoke execute on function admin_salons() from public, anon;
grant execute on function admin_salons() to authenticated;

-- Vlasnica mora da vidi svoj datum, inače pauza dolazi kao iznenađenje.
-- Ostatak funkcije je nepromenjen.

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
    ), '[]'::jsonb)
  );
end;
$function$;

revoke execute on function dashboard_week(date, uuid) from public, anon;
grant execute on function dashboard_week(date, uuid) to authenticated;
