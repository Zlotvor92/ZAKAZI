-- Termini za kalendar salona, sa imenom klijentkinje i nazivom usluge.
--
-- Bez `security definer`: RLS nad sva tri izvora i dalje važi, pa upit vraća
-- samo termine salona u kom je pozivalac član. Funkcija postoji da bi to bio
-- jedan poziv umesto tri, ne da bi zaobišla ijednu politiku.
create function dashboard_appointments(
  p_from timestamptz,
  p_to timestamptz
) returns table (
  id uuid,
  start_at timestamptz,
  end_at timestamptz,
  status appointment_status,
  source appointment_source,
  price_rsd integer,
  duration_min integer,
  buffer_after_min integer,
  client_name text,
  client_phone text,
  service_name text
)
language sql
stable
set search_path = public
as $$
  select a.id, a.start_at, a.end_at, a.status, a.source, a.price_rsd,
         a.duration_min, a.buffer_after_min,
         c.name, c.phone_e164, s.name
  from appointments a
  join clients c on c.id = a.client_id
  join services s on s.id = a.service_id
  where a.start_at >= p_from
    and a.start_at < p_to
  order by a.start_at
$$;

revoke execute on function dashboard_appointments(timestamptz, timestamptz)
  from public, anon;
grant execute on function dashboard_appointments(timestamptz, timestamptz)
  to authenticated;
