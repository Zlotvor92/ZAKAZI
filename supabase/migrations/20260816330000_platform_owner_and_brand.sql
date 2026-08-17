-- Ko koga vidi, i kako salon izgleda.
--
-- Dva odvojena posla, ali oba menjaju istu tabelu `tenants` i istu funkciju
-- `create_tenant`, pa idu zajedno da se ona ne piše dva puta.

-- Vlasnik platforme --------------------------------------------------------

/*
 * Nalog koji vidi sve salone, radi kontrole.
 *
 * Izolacija se i dalje oslanja isključivo na `memberships` i RLS — ovde se ne
 * uvodi nikakvo zaobilaženje politika. Vlasnik platforme jednostavno dobija
 * članstvo u svakom salonu, pa mu iste politike koje čuvaju tuđe podatke
 * pokazuju njegove. Nijedna postojeća politika se ne dira, i to je poenta:
 * svaki `or` dodat u trideset politika je trideset prilika za grešku.
 *
 * Tabela nema nijednu politiku, pa je kroz API ne čita niko. Menja se samo
 * preko `service_role`, iz Supabase panela.
 */
create table platform_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table platform_owners enable row level security;

-- Izgled salona ------------------------------------------------------------

/*
 * Boje javne stranice, po salonu.
 *
 * Ne šablon po imenu nego same boje: novi salon dobija svoj izgled unosom tri
 * vrednosti, bez ijedne izmene koda. `null` znači podrazumevani izgled.
 */
alter table tenants
  add column brand_background text,
  add column brand_primary text,
  add column brand_accent text,
  add constraint tenants_brand_format check (
    (brand_background is null or brand_background ~ '^#[0-9a-f]{6}$')
    and (brand_primary is null or brand_primary ~ '^#[0-9a-f]{6}$')
    and (brand_accent is null or brand_accent ~ '^#[0-9a-f]{6}$')
  );

-- Novi salon nosi i jedno i drugo ------------------------------------------

create or replace function create_tenant(
  p_name text,
  p_slug text,
  p_timezone text default 'Europe/Belgrade'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_tenant_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  if v_name = '' or length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  -- Slug završi u adresi koju salon deli na Instagramu, pa sme samo ono što
  -- se može otkucati bez razmišljanja. Ispod tri znaka se ne daje: kratke
  -- adrese su zajednički resurs, ne nagrada za brzinu.
  if length(v_slug) < 3
     or v_slug !~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_slug');
  end if;

  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_timezone');
  end if;

  if exists (select 1 from tenants where slug = v_slug) then
    return jsonb_build_object('ok', false, 'reason', 'slug_taken');
  end if;

  insert into tenants (slug, name, timezone, plan)
  values (v_slug, v_name, p_timezone, 'trial')
  returning id into v_tenant_id;

  insert into memberships (user_id, tenant_id, role)
  values (v_user_id, v_tenant_id, 'owner');

  -- Vlasnik platforme ulazi u svaki salon čim salon nastane. Da se dodaje
  -- ručno, prvi zaboravljeni salon bio bi salon koji niko ne kontroliše.
  insert into memberships (user_id, tenant_id, role)
  select po.user_id, v_tenant_id, 'owner'
  from platform_owners po
  where po.user_id <> v_user_id
  on conflict (user_id, tenant_id) do nothing;

  -- Solo majstor je i vlasnik i izvođač; bez izvođača salon nema radno vreme
  -- ni kome da se zakaže.
  insert into staff (tenant_id, user_id, name)
  values (v_tenant_id, v_user_id, v_name);

  return jsonb_build_object('ok', true, 'id', v_tenant_id, 'slug', v_slug);
end;
$$;

-- Javna stranica dobija boje ----------------------------------------------

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

  if not found or not v_tenant.public_booking_enabled then
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
      'brand_accent', v_tenant.brand_accent
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
