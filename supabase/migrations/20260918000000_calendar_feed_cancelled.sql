-- Otkazan termin izlazi iz kalendara i kad ga aplikacija ne obriše sama -----
--
-- Do sada je otkazan termin jednostavno nestajao iz odgovora i računalo se da
-- će ga kalendar aplikacija sama skloniti. To je pretpostavka, ne dogovor:
-- standard ima izričito poništenje (`STATUS:CANCELLED`), a nestanak reda je
-- samo nagoveštaj. Aplikacija koja spaja po `UID`-u umesto da svaki put briše
-- sve, ostavi unos da stoji.
--
-- Zato otkazani termini i dalje izlaze, u istom prozoru kao i ostali, da bi
-- ruta mogla da pošalje poništenje. Ispadnu sami kad im vreme prođe.

create or replace function calendar_feed(p_token uuid)
returns table (
  tenant_name text,
  timezone text,
  appointment_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  service_name text,
  staff_name text,
  client_name text,
  client_phone text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.name,
    t.timezone,
    a.id,
    a.start_at,
    a.end_at,
    s.name,
    st.name,
    c.name,
    c.phone_e164,
    a.status::text
  from tenants t
  join appointments a on a.tenant_id = t.id
  join services s on s.tenant_id = a.tenant_id and s.id = a.service_id
  join staff st on st.tenant_id = a.tenant_id and st.id = a.staff_id
  join clients c on c.tenant_id = a.tenant_id and c.id = a.client_id
  where p_token is not null
    and t.calendar_token = p_token
    and a.status in (
      'pending', 'confirmed', 'cancelled_by_client', 'cancelled_by_salon'
    )
    and a.start_at >= now() - interval '7 days'
    and a.start_at <= now() + interval '180 days'
  order by a.start_at;
$$;

revoke execute on function calendar_feed(uuid) from public;
grant execute on function calendar_feed(uuid) to anon, authenticated;
