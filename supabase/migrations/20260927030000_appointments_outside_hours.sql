-- Zakazani termini van radnog vremena -----------------------------------------
--
-- Kad vlasnica skrati smenu ili isključi dan, termini koji su već zakazani u
-- tom vremenu ostaju — i treba da ostanu, klijentkinje računaju na njih. Ali
-- vlasnica mora da zna da postoje, inače zaboravi da ih pozove.
--
-- Termin je van radnog vremena kad mu početak, po satu salona, ne pada ni u
-- jedan komad rada tog izvođača tog dana u nedelji. Kraj se ne gleda: termin
-- sme da pređe kraj smene koliko pravila zakazivanja dozvoljavaju.
--
-- Bez `security definer`: vlasnica vidi samo svoje termine, RLS odseca ostalo.

create function appointments_outside_hours(p_tenant_id uuid default null)
returns table (
  id uuid,
  start_at timestamptz,
  client_name text,
  service_name text
)
language sql
stable
set search_path = public
as $$
  select a.id, a.start_at, c.name, s.name
  from appointments a
  join tenants t on t.id = a.tenant_id
  join clients c on c.id = a.client_id
  join services s on s.id = a.service_id
  where a.tenant_id = resolve_tenant(p_tenant_id)
    and a.status in ('pending', 'confirmed')
    and a.start_at >= now()
    and not exists (
      select 1
      from working_hours w
      where w.staff_id = a.staff_id
        and w.weekday = extract(isodow from a.start_at at time zone t.timezone)
        and (a.start_at at time zone t.timezone)::time >= w.start_time
        and (a.start_at at time zone t.timezone)::time < w.end_time
    )
  order by a.start_at
$$;

revoke execute on function appointments_outside_hours(uuid) from public, anon;
grant execute on function appointments_outside_hours(uuid) to authenticated;
