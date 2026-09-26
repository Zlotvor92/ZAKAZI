-- Zamenska usluga za „ne može posle" -----------------------------------------
--
-- Pravilo „korekcija ne može posle skidanja" do sada je za zamensku uslugu
-- uzimalo uslugu iz roka od N dana („dolazak na ovu uslugu ili na …"). Salon
-- koji za nokte nema rok nije mogao ni da sačuva pravilo.
--
-- Sada salon bira i zamensku uslugu — onu koju klijentkinja zakazuje umesto
-- korekcije (izlivanje, nadogradnja). Ona ima dve uloge:
--   * nudi se klijentkinji u poruci;
--   * dolazak na nju zatvara skidanje, pa je korekcija posle nje opet moguća.
-- Rok od N dana postaje nezavisno pravilo.
--
-- Postojeća pravila zadržavaju ponašanje: zamenska usluga im se popunjava
-- uslugom iz roka, koja je do sada imala tu ulogu.

alter table services
  add column not_after_instead_service_id uuid,
  add constraint services_not_after_instead_not_self
    check (not_after_instead_service_id <> id),
  add constraint services_not_after_instead_service_fkey
    foreign key (tenant_id, not_after_instead_service_id)
    references services (tenant_id, id)
    on delete set null (not_after_instead_service_id);

update services
   set not_after_instead_service_id = requires_service_id
 where not_after_service_id is not null
   and requires_service_id is not null;

create or replace function service_sequence_problem(
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
      'required_service_name', i.name
    ) as problem
    from services s
    join services b on b.id = s.not_after_service_id
    -- Uklonjena zamenska usluga ne sme da se nudi, pa se pravilo gasi.
    join services i on i.id = s.not_after_instead_service_id and i.active
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
        where v.service_id = i.id
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
    -- Uklonjena zamenska usluga ne sme da se nudi, pa se pravilo gasi.
    join services i on i.id = s.not_after_instead_service_id and i.active
    join visits later
      on later.service_id = s.id and later.start_at > p_start_at
    where b.id = p_service_id
      and b.tenant_id = p_tenant_id
      and not exists (
        select 1 from visits v
        where v.service_id = i.id
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

drop function upsert_service(uuid, text, integer, integer, uuid, text, uuid, integer, uuid);

create function upsert_service(
  p_id uuid,
  p_name text,
  p_duration_min integer,
  p_price_rsd integer,
  p_tenant_id uuid default null,
  p_description text default null,
  p_requires_service_id uuid default null,
  p_requires_within_days integer default null,
  p_not_after_service_id uuid default null,
  p_not_after_instead_service_id uuid default null
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

  -- Obe usluge pravila, ili nijedna: bez zamenske nema čime se skidanje
  -- zatvara, a klijentkinji ne bi imalo šta da se ponudi.
  if (p_not_after_service_id is null) <> (p_not_after_instead_service_id is null)
     or p_not_after_service_id = p_id
     or p_not_after_instead_service_id = p_id
     or p_not_after_service_id = p_not_after_instead_service_id then
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

  if p_not_after_service_id is not null and (
    select count(*) from services
    where id in (p_not_after_service_id, p_not_after_instead_service_id)
      and tenant_id = v_tenant_id and active
  ) <> 2 then
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
           not_after_service_id = p_not_after_service_id,
           not_after_instead_service_id = p_not_after_instead_service_id
     where id = p_id and tenant_id = v_tenant_id
    returning id into v_id;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  insert into services (
    tenant_id, name, duration_min, price_rsd, description,
    requires_service_id, requires_within_days, not_after_service_id,
    not_after_instead_service_id
  )
  values (
    v_tenant_id, v_name, p_duration_min, p_price_rsd, v_description,
    p_requires_service_id, p_requires_within_days, p_not_after_service_id,
    p_not_after_instead_service_id
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

revoke execute on function upsert_service(uuid, text, integer, integer, uuid, text, uuid, integer, uuid, uuid)
  from public, anon;
grant execute on function upsert_service(uuid, text, integer, integer, uuid, text, uuid, integer, uuid, uuid)
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
  not_after_service_id uuid,
  not_after_instead_service_id uuid
)
language sql
stable
set search_path = public
as $$
  select s.id, s.name, s.duration_min, s.price_rsd, s.description,
         s.requires_service_id, s.requires_within_days, s.not_after_service_id,
         s.not_after_instead_service_id
  from services s
  where s.tenant_id = resolve_tenant(p_tenant_id) and s.active
  order by s.sort_order, s.name
$$;

revoke execute on function tenant_services(uuid) from public, anon;
grant execute on function tenant_services(uuid) to authenticated;
