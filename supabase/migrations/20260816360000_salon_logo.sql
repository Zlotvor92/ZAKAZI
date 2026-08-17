-- Logo salona.
--
-- Slika stoji u Supabase Storage-u, u bazi joj je samo adresa. Slike u bazi
-- znače da svaki upit nad salonom vuče megabajte, a `tenants` se čita na
-- svakom otvaranju kalendara.
--
-- Kolonu ne može da menja vlasnica: privilegija nad kolonama nad `tenants` joj
-- daje samo tri polja. Menja je funkcija ispod, i samo vlasnik platforme.

alter table tenants
  add column logo_url text,
  add constraint tenants_logo_url_format check (
    logo_url is null or (logo_url ~ '^https://' and length(logo_url) <= 500)
  );

create function set_tenant_logo(
  p_tenant_id uuid,
  p_logo_url text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(btrim(coalesce(p_logo_url, '')), '');
begin
  if not is_platform_owner() then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if v_url is not null and (v_url !~ '^https://' or length(v_url) > 500) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_url');
  end if;

  update tenants set logo_url = v_url where id = p_tenant_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function set_tenant_logo(uuid, text) from public, anon;
grant execute on function set_tenant_logo(uuid, text) to authenticated;

-- Javna stranica dobija logo ---------------------------------------------

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
     or v_tenant.suspended_at is not null then
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

-- Konzola prikazuje da li salon ima logo ---------------------------------

drop function admin_salons();

create function admin_salons() returns table (
  id uuid,
  slug text,
  name text,
  suspended boolean,
  owner_email text,
  logo_url text,
  created_at timestamptz,
  services_count integer,
  upcoming_count integer,
  last_booking_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.slug,
    t.name,
    t.suspended_at is not null,
    (
      -- Vlasnica salona je član koji ne upravlja platformom.
      select u.email::text
      from memberships m
      join auth.users u on u.id = m.user_id
      where m.tenant_id = t.id
        and not exists (
          select 1 from platform_owners po where po.user_id = m.user_id
        )
      order by m.created_at
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
    (select max(a.created_at) from appointments a where a.tenant_id = t.id)
  from tenants t
  where is_platform_owner()
  order by t.created_at
$$;

revoke execute on function admin_salons() from public, anon;
grant execute on function admin_salons() to authenticated;
