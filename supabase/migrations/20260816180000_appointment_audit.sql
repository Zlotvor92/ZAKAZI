-- Pravilo je da svaka promena statusa termina ostavlja trag, bez izuzetka.
-- Dogovor da to radi aplikacioni kod prekrši se prvi put kad neko doda novu
-- putanju i zaboravi, a upravo tada trag i zatreba. Zato ga piše baza.
--
-- Ko je akter se ne prosleđuje kroz parametre nego kroz podešavanja
-- transakcije, jer između `insert into appointments` i ovog trigera nema
-- mesta da se doda argument.
--
--   app.actor_type  'client' kad upisuje javna stranica; inače se pogađa
--   app.device_id   uređaj sa kog je izmena došla
--
-- Kad `app.actor_type` nije postavljen: prijavljen korisnik je `user`, a
-- odsustvo prijavljenog korisnika je `system`.

create function log_appointment_status_change() returns trigger
language plpgsql
-- Trag mora da nastane i kad politika nad `appointment_events` ne bi pustila
-- aktera da piše. Funkcija ne prima ništa spolja i piše samo u audit log.
security definer
set search_path = public
as $$
declare
  v_actor_type actor_type;
  v_actor_id uuid;
  v_device_id text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  v_device_id := nullif(current_setting('app.device_id', true), '');
  v_actor_id := auth.uid();

  begin
    v_actor_type :=
      nullif(current_setting('app.actor_type', true), '')::actor_type;
  exception when invalid_text_representation then
    v_actor_type := null;
  end;

  if v_actor_type is null then
    v_actor_type := case when v_actor_id is null then 'system' else 'user' end;
  end if;

  insert into appointment_events (
    tenant_id, appointment_id, from_status, to_status,
    actor_type, actor_id, device_id
  ) values (
    new.tenant_id,
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    v_actor_type,
    -- `actor_id` pokazuje na `auth.users`, pa ga nosi samo akter koji je
    -- stvarno prijavljen korisnik.
    case when v_actor_type = 'user' then v_actor_id end,
    v_device_id
  );

  return null;
end;
$$;

revoke execute on function log_appointment_status_change() from public;

-- AFTER, jer strani ključ iz `appointment_events` traži da termin već postoji.
-- Bez `update of status`: triger sam poredi stari i novi status, pa nijedan
-- način da se kolona promeni ne može da promakne.
create trigger appointments_log_status_change
  after insert or update on appointments
  for each row execute function log_appointment_status_change();
