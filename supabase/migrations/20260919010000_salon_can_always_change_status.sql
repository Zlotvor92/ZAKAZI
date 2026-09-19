-- Salon sme da vrati svaki status -------------------------------------------
--
-- Dosad je `no_show` vodio samo u `completed` i natrag, a otkazan termin
-- nikuda. Vlasnica koja promaši dugme na telefonu — a to je svakodnevica —
-- ostajala je sa pogrešnim izostankom ili otkazanim terminom koji ne može da
-- vrati. To je njen kalendar i njena odluka; aplikacija nema šta da je
-- sprečava.
--
-- Nijedan prelaz se ne gubi iz istorije: `appointment_events` beleži svaku
-- promenu, pa „ko je ovo otkazao" i dalje ima odgovor.
--
-- `appointment_status_allowed` ostaje i dalje se koristi, ali samo tamo gde
-- odluku donosi klijentkinja (`public_cancel_appointment`): ona sme da otkaže
-- termin koji stoji, a ne da vrati onaj koji je salon zatvorio.

create or replace function change_appointment_status(
  p_appointment_id uuid,
  p_status appointment_status,
  p_device_id text default null
) returns jsonb
language plpgsql
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

  perform set_config('app.device_id', coalesce(p_device_id, ''), true);

  -- Vraćanje otkazanog ili završenog termina u `confirmed` ponovo zauzima
  -- njegovo vreme, a ono je u međuvremenu moglo da ode nekom drugom. Tada
  -- ograničenje iz baze zaustavi upis, i to mora da stigne kao poruka a ne
  -- kao pad.
  begin
    update appointments
       set status = p_status,
           confirmed_at = case
             when p_status = 'confirmed' and confirmed_at is null then now()
             else confirmed_at
           end
     where id = p_appointment_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end;

  return jsonb_build_object('ok', true, 'from_status', v_from,
                            'to_status', p_status);
end;
$$;
