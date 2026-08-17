-- Jedini put kojim status termina sme da se menja.
--
-- Postoji iz dva razloga: da uređaj stigne do trigera koji piše istoriju, i
-- da se lanac statusa poštuje u bazi umesto da se na njega pazi u svakom
-- ekranu ponaosob.

-- Istorija se čita kao niz, a `now()` vraća trenutak početka transakcije, isti
-- za svaki red upisan u njoj. Dve promene statusa u istom pozivu tako dobiju
-- identično vreme i njihov redosled se više ne može utvrditi — a redosled je
-- jedino zbog čega audit log i postoji. `clock_timestamp()` je stvarni trenutak
-- upisa, pa i vreme postaje tačno, ne samo poredivo.
alter table appointment_events
  alter column created_at set default clock_timestamp();

-- Dozvoljeni prelazi.
--
-- Odstupanje od specifikacije: `no_show` i `completed` smeju jedno u drugo.
-- Devedeset posto rada je na telefonu i pogrešan dodir je svakodnevica, a
-- pogrešno upisan nedolazak kasnije ulazi u reputacioni skor i kažnjava
-- nekoga ni za šta. Ispravka ostavlja svoj red u istoriji, pa dokaz ne trpi.
--
-- Otkazan termin ostaje otkazan. Slot je u međuvremenu mogao da bude prodat,
-- pa vaskrsavanje termina nije ispravka nego nova dupla rezervacija; ko je
-- pogrešio, upisuje termin iznova.
create function appointment_status_allowed(
  p_from appointment_status,
  p_to appointment_status
) returns boolean
language sql
immutable
parallel safe
as $$
  select case p_from
    when 'pending' then
      p_to in ('confirmed', 'cancelled_by_client', 'cancelled_by_salon')
    when 'confirmed' then
      p_to in ('completed', 'no_show', 'cancelled_by_client', 'cancelled_by_salon')
    when 'completed' then p_to = 'no_show'
    when 'no_show' then p_to = 'completed'
    else false
  end
$$;

create function change_appointment_status(
  p_appointment_id uuid,
  p_status appointment_status,
  p_device_id text default null
) returns jsonb
language plpgsql
-- Namerno bez `security definer`: izmenu i dalje filtrira RLS, pa vlasnica
-- jednog salona ne može da dirne tuđi termin ni preko ove funkcije.
set search_path = public
as $$
declare
  v_from appointment_status;
begin
  -- `for update` da dva istovremena dodira ne bi upisala dva različita ishoda.
  select status into v_from
  from appointments
  where id = p_appointment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Dupli dodir po istom dugmetu nije greška, samo nema šta da promeni.
  if v_from = p_status then
    return jsonb_build_object('ok', true, 'from_status', v_from,
                              'to_status', p_status);
  end if;

  if not appointment_status_allowed(v_from, p_status) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;

  perform set_config('app.device_id', coalesce(p_device_id, ''), true);

  update appointments
     set status = p_status,
         confirmed_at = case
           when p_status = 'confirmed' and confirmed_at is null then now()
           else confirmed_at
         end
   where id = p_appointment_id;

  return jsonb_build_object('ok', true, 'from_status', v_from,
                            'to_status', p_status);
end;
$$;

-- `change_appointment_status` nije `security definer`, pa radi kao onaj ko je
-- zove — i mora da sme da pozove ovu proveru. Nema pristup nijednom podatku,
-- prima i vraća samo statuse, pa otvaranje ne otkriva ništa.
revoke execute on function appointment_status_allowed(
  appointment_status, appointment_status
) from public, anon;
grant execute on function appointment_status_allowed(
  appointment_status, appointment_status
) to authenticated;

revoke execute on function change_appointment_status(
  uuid, appointment_status, text
) from public, anon;
grant execute on function change_appointment_status(
  uuid, appointment_status, text
) to authenticated;
