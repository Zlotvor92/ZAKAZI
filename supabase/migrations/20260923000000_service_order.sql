-- Salon sam slaže redosled usluga -------------------------------------------
--
-- Do sada su usluge išle po abecedi, pa je jedini način da „Gel nokti" dođu
-- ispred „Korekcije" bio da se jedna obriše i unese ponovo. Brisanje usluge
-- koju je neko već zakazao je gasi, pa je salon ostajao sa duplikatima.
--
-- Postojeće usluge zadržavaju abecedni redosled koji su do sada imale, da se
-- javna strana ne promeni sama od sebe.

alter table services add column sort_order int not null default 0;

update services s
   set sort_order = ordered.position
  from (
    select id, row_number() over (partition by tenant_id order by name, id) as position
    from services
  ) ordered
 where ordered.id = s.id;

-- Nova usluga ide na kraj spiska: salon ju je tek uneo i očekuje je tamo gde
-- je dodao, ne negde u sredini po abecedi.
create function services_append_last() returns trigger
language plpgsql
set search_path = public
as $$
begin
  select coalesce(max(sort_order), 0) + 1
    into new.sort_order
    from services
   where tenant_id = new.tenant_id;

  return new;
end;
$$;

-- Okidač ne proverava pravo izvršavanja, pa zatvaranje ne smeta upisu, a
-- površina za neprijavljene ostaje ista.
revoke execute on function services_append_last() from public, anon;

create trigger services_append_last
  before insert on services
  for each row execute function services_append_last();

/*
 * Pomera uslugu za jedno mesto gore ili dole među aktivnim uslugama salona.
 *
 * Ceo spisak se prepisuje redom, ne menjaju se samo dve susedne vrednosti:
 * ugašene usluge i istovremeno dodate ostavljaju rupe i jednake brojeve, a
 * zamena dve jednake vrednosti ne pomera ništa.
 *
 * Bez `security definer`: RLS i ovde odlučuje čije se usluge vide i menjaju.
 */
create function move_service(
  p_id uuid,
  p_direction text,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_ids uuid[];
  v_from int;
  v_to int;
begin
  if p_direction not in ('up', 'down') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_direction');
  end if;

  -- Dva brza dodira na dva uređaja ne smeju da čitaju isti stari redosled.
  perform 1 from services where tenant_id = v_tenant_id for update;

  select array_agg(id order by sort_order, name, id)
    into v_ids
    from services
   where tenant_id = v_tenant_id and active;

  v_from := array_position(v_ids, p_id);

  if v_from is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_to := v_from + case when p_direction = 'up' then -1 else 1 end;

  if v_to < 1 or v_to > cardinality(v_ids) then
    return jsonb_build_object('ok', true);
  end if;

  v_ids[v_from] := v_ids[v_to];
  v_ids[v_to] := p_id;

  update services s
     set sort_order = ordered.position
    from unnest(v_ids) with ordinality as ordered(id, position)
   where s.id = ordered.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function move_service(uuid, text, uuid) from public, anon;
grant execute on function move_service(uuid, text, uuid) to authenticated;

create or replace function tenant_services(p_tenant_id uuid default null)
returns table (
  id uuid,
  name text,
  duration_min integer,
  price_rsd integer
)
language sql
stable
set search_path = public
as $$
  select s.id, s.name, s.duration_min, s.price_rsd
  from services s
  where s.tenant_id = resolve_tenant(p_tenant_id) and s.active
  order by s.sort_order, s.name
$$;

-- `public_booking_data`: klijent vidi usluge redom koji je salon složio ------

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
