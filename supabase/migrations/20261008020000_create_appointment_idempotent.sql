-- Ručni unos termina je idempotentan: isti zahtev dvaput daje isti termin --------
--
-- Kad odgovor na ručni unos nestane (loša mreža), vlasnica ne zna da li je
-- termin upisan i pošalje ponovo. Isti slot je tada već zauzet — njenim
-- sopstvenim terminom — pa je dobijala „to vreme je zauzeto" za termin koji je
-- upravo sama napravila. Forma sada uz zahtev šalje `request_id`; ako termin sa
-- njim već postoji u salonu, vraća se on, bez novog upisa.
--
-- Isti mehanizam kao u `public_book` (20260928010000): kolona `request_id` i
-- jedinstveni indeks po salonu već postoje. Ograničenje preklapanja ostaje
-- jedina odbrana od dvostrukog zauzimanja; ovde se samo prepoznaje da je
-- „zauzeto" zapravo isti zahtev.
--
-- Funkcije rade sa pravima pozivaoca, kao i `create_appointment`: RLS i dalje
-- odlučuje šta vlasnica sme da vidi, pa tuđi `request_id` ništa ne otkriva.

create function create_appointment_replay(
  p_tenant_id uuid,
  p_request_id uuid,
  p_service_id uuid,
  p_start_at timestamptz,
  p_duration_min integer,
  p_phone_e164 text
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_found record;
begin
  if p_request_id is null then
    return null;
  end if;

  select a.id, a.start_at, a.duration_min, a.service_id, a.status,
         c.phone_e164
    into v_found
  from appointments a
  join clients c on c.id = a.client_id
  where a.tenant_id = p_tenant_id and a.request_id = p_request_id;

  if not found then
    return null;
  end if;

  -- Isti `request_id` za drugačiji zahtev nije ponavljanje. Odbija se bez
  -- ikakvih podataka o postojećem terminu.
  if v_found.phone_e164 <> p_phone_e164
     or v_found.service_id <> p_service_id
     or v_found.start_at <> p_start_at
     or v_found.duration_min <> p_duration_min
     or v_found.status not in ('pending', 'confirmed') then
    return jsonb_build_object('ok', false, 'reason', 'request_conflict');
  end if;

  return jsonb_build_object(
    'ok', true,
    'replayed', true,
    'appointment_id', v_found.id
  );
end;
$$;

revoke execute on function
  create_appointment_replay(uuid, uuid, uuid, timestamptz, integer, text)
  from public, anon;
grant execute on function
  create_appointment_replay(uuid, uuid, uuid, timestamptz, integer, text)
  to authenticated;

drop function create_appointment(uuid, timestamptz, integer, text, text, text);

create function create_appointment(
  p_service_id uuid,
  p_start_at timestamptz,
  p_duration_min integer,
  p_client_name text,
  p_phone_e164 text,
  p_device_id text default null,
  p_request_id uuid default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_service services;
  v_staff_id uuid;
  v_name text;
  v_client_id uuid;
  v_appointment_id uuid;
  v_replay jsonb;
begin
  v_name := btrim(coalesce(p_client_name, ''));
  if v_name = '' or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  if p_duration_min is null or p_duration_min <= 0 or p_duration_min > 1440 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_duration');
  end if;

  select * into v_service from services where id = p_service_id and active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_service');
  end if;

  -- Ponovljen zahtev vraća termin koji već postoji, pre svake druge provere
  -- zauzetosti: slot jeste zauzet, ali njegovim sopstvenim terminom.
  v_replay := create_appointment_replay(
    v_service.tenant_id, p_request_id, p_service_id, p_start_at,
    p_duration_min, p_phone_e164
  );

  if v_replay is not null then
    return v_replay;
  end if;

  select id into v_staff_id
  from staff
  where tenant_id = v_service.tenant_id and active
  order by created_at, id
  limit 1;

  if v_staff_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  perform set_config('app.device_id', coalesce(p_device_id, ''), true);

  begin
    insert into clients (tenant_id, name, phone_e164)
    values (v_service.tenant_id, v_name, p_phone_e164)
    on conflict (tenant_id, phone_e164) do nothing;

    select id into v_client_id
    from clients
    where tenant_id = v_service.tenant_id and phone_e164 = p_phone_e164;

    insert into appointments (
      tenant_id, staff_id, service_id, client_id, start_at,
      duration_min, buffer_after_min, price_rsd, status, source, confirmed_at,
      request_id
    ) values (
      v_service.tenant_id, v_staff_id, v_service.id, v_client_id, p_start_at,
      p_duration_min, 0, v_service.price_rsd, 'confirmed', 'salon', now(),
      p_request_id
    )
    returning id into v_appointment_id;
  exception when exclusion_violation or unique_violation then
    -- Dva istovremena zahteva sa istim `request_id`: onaj koji je izgubio
    -- trku ovde vidi termin pobednika, pa dobija isti odgovor.
    v_replay := create_appointment_replay(
      v_service.tenant_id, p_request_id, p_service_id, p_start_at,
      p_duration_min, p_phone_e164
    );

    if v_replay is not null then
      return v_replay;
    end if;

    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end;

  return jsonb_build_object('ok', true, 'appointment_id', v_appointment_id);
end;
$$;

revoke execute on function
  create_appointment(uuid, timestamptz, integer, text, text, text, uuid)
  from public, anon;
grant execute on function
  create_appointment(uuid, timestamptz, integer, text, text, text, uuid)
  to authenticated;
