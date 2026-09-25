-- Kartica klijentkinje ---------------------------------------------------------
--
-- Klijentkinja je vezana za broj telefona: `clients` ima jedan red po broju u
-- salonu, i svaki termin sa tog broja pokazuje na njega. Kartica zato sabira
-- sve termine tog broja, bez obzira na ime koje je upisano pri zakazivanju.
--
-- Vlasnica je do sada videla samo ime na terminu. Da li je to stalna
-- mušterija ili neko ko je dvaput izostao, znala je samo iz glave.
--
-- Bez `security definer`: RLS bira i termin i klijentkinju, pa nečlan salona
-- dobija `null`, isto kao za termin koji ne postoji.

create function client_card(p_appointment_id uuid) returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'client_id', c.id,
    'name', c.name,
    'phone_e164', c.phone_e164,
    'notes', c.notes,
    'first_seen', c.created_at,
    'completed', count(*) filter (where h.status = 'completed'),
    'no_show', count(*) filter (where h.status = 'no_show'),
    'cancelled_by_client', count(*) filter (where h.status = 'cancelled_by_client'),
    'cancelled_by_salon', count(*) filter (where h.status = 'cancelled_by_salon'),
    'upcoming', count(*) filter (
      where h.status in ('pending', 'confirmed') and h.start_at >= now()
    ),
    'last_visit', max(h.start_at) filter (where h.status = 'completed'),
    'blocked', exists (
      select 1 from blocklist b
      where b.tenant_id = c.tenant_id and b.phone_e164 = c.phone_e164
    )
  )
  from appointments a
  join clients c on c.id = a.client_id
  join appointments h on h.client_id = c.id
  where a.id = p_appointment_id
  group by c.id
$$;

revoke execute on function client_card(uuid) from public, anon;
grant execute on function client_card(uuid) to authenticated;

/*
 * Beleška o klijentkinji: alergija, omiljena boja, „uvek kasni 10 minuta".
 * Prazna beleška se čuva kao `null`, da se prazno polje ne bi razlikovalo od
 * nikad popunjenog.
 */
create function set_client_notes(p_client_id uuid, p_notes text) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if length(v_notes) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'too_long');
  end if;

  update clients set notes = v_notes where id = p_client_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function set_client_notes(uuid, text) from public, anon;
grant execute on function set_client_notes(uuid, text) to authenticated;
