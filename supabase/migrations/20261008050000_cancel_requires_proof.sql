-- Broj telefona sam više ne otvara termin -------------------------------------
--
-- Do sada je za pregled i otkazivanje preko sajta bio dovoljan broj telefona:
-- ko zna tuđ broj video je njene termine i mogao da ih otkaže. Brojevi se ne
-- kriju (salon ih ima, klijentkinje ih daju svakom), pa sam broj ne sme da
-- bude ključ. Ograničenje po mreži i po broju je samo ublažavalo štetu.
--
-- Broj telefona ostaje u formi „Pronađi svoj termin", ali termin se vidi i
-- otkazuje tek kad uz broj stigne i dokaz da je zakazan sa ovog pregledača:
--
--   1. tajna termina. Stranica pri zakazivanju smisli 256 bita nasumičnih
--      znakova i pošalje ih uz zahtev; ovde se čuva samo njen SHA-256. Tajna
--      stoji u kolačiću telefona sa kog je zakazano i u linku koji se može
--      sačuvati, pa otkazivanje radi i sa drugog telefona. Baza nikad ne vidi
--      ni ne čuva samu tajnu, pa je ni salon, ni dump, ni log ne mogu otkriti.
--
--   2. prelazno, za termine koji su već zakazani (bez tajne): uređaj sa kog je
--      zakazano. To je `device_id` na događaju kojim je termin nastao, i to
--      samo ako ga je napravila klijentkinja preko sajta; termin koji je upisala
--      vlasnica salona nosi vlasničin uređaj i ne sme da se prizna kao tuđ.
--      Ova grana nestaje sama: svi novi termini nose tajnu, a termin je
--      najdalje `booking_horizon_days` unapred. Posle toga nijedan termin više
--      ne ulazi u nju i grana (`manage_proof_hash is null` u
--      `owned_appointment_ids`) može da se skine.
--
-- Treba oboje: dokaz bez broja ne otvara ništa, broj bez dokaza ne otvara
-- ništa. Pogrešan broj, tuđ salon, nepostojeći termin i nedostajući dokaz daju
-- isti odgovor, pa se iz razlike ne može ništa pročitati.
--
-- Termin koji je upisala vlasnica salona nema ni jedno ni drugo, pa se preko
-- sajta ne otkazuje: klijentkinja se javi salonu, kao i do sada kad nešto
-- iskrsne.
--
-- Funkcije koje primaju samo broj telefona (`public_appointments_for_phone` i
-- stari oblik `public_cancel_appointment`) se brišu, ne preusmeravaju: stari
-- kod koji ih zove za vreme puštanja dobija grešku, ne lažnu „nema termina".
--
-- Brojač pokušaja po mreži za pretragu više nema šta da štiti: bez tajne od
-- 256 bita (ili uređaja od 122) pogađanjem brojeva se ne stiže nigde. Tabela,
-- funkcije i čišćenje ostaju netaknuti. Ograničenje od tri samootkazivanja
-- dnevno po broju ostaje: štiti salon i od klijentkinje koja iznova zakazuje
-- pa otkazuje.

alter table appointments add column manage_proof_hash text;

alter table appointments
  add constraint appointments_manage_proof_hash_format
  check (manage_proof_hash is null or manage_proof_hash ~ '^[0-9a-f]{64}$');

comment on column appointments.manage_proof_hash is
  'SHA-256 tajne kojom klijentkinja dokazuje da je termin njen. Same tajne u bazi nema.';

-- Pretraga ide po salonu pa po hešu. Bez indeksa bi svaki pokušaj pogađanja,
-- a otvoren je svakome, prošao kroz celu tabelu.
create index appointments_manage_proof_hash_idx
  on appointments (tenant_id, manage_proof_hash)
  where manage_proof_hash is not null;

create function hash_manage_proof(p_proof text) returns text
language sql
immutable
strict
set search_path = public
as $$
  select encode(sha256(convert_to(p_proof, 'UTF8')), 'hex');
$$;

-- Termini salona koje dati broj i dati dokazi zajedno otvaraju. Jedini
-- predikat vlasništva: i pregled i otkazivanje idu kroz njega, pa ne mogu da se
-- razilaze.
create function owned_appointment_ids(
  p_tenant_id uuid,
  p_phone_e164 text,
  p_secrets text[],
  p_device_id text
) returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id
  from appointments a
  join clients c on c.id = a.client_id
  where a.tenant_id = p_tenant_id
    and c.phone_e164 = p_phone_e164
    and (
      a.manage_proof_hash in (
        select hash_manage_proof(s) from unnest(p_secrets[1:10]) as s
      )
      or (
        a.manage_proof_hash is null
        and a.source = 'public'
        and coalesce(p_device_id, '') <> ''
        and exists (
          select 1 from appointment_events e
          where e.tenant_id = a.tenant_id
            and e.appointment_id = a.id
            and e.from_status is null
            and e.actor_type = 'client'
            and e.device_id = p_device_id
        )
      )
    );
$$;

revoke execute on function hash_manage_proof(text)
  from public, anon, authenticated;
revoke execute on function owned_appointment_ids(uuid, text, text[], text)
  from public, anon, authenticated;

-- Zakazivanje pamti heš tajne ---------------------------------------------------
--
-- Stari oblik se briše: novi ima isti naziv i podrazumevanu vrednost za
-- `p_manage_proof`, pa bi poziv sa osam parametara bio dvosmislen. Stari kod
-- koji ne šalje tajnu i dalje radi, i njegovi termini idu kroz prelaznu granu.

drop function public_book(text, uuid, timestamptz, text, text, text, text, uuid);

create function public_book(p_slug text, p_service_id uuid, p_start_at timestamp with time zone, p_client_name text, p_phone_e164 text, p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_manage_proof text DEFAULT NULL::text)
 RETURNS jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window jsonb;
  v_sequence jsonb;
  v_tenant tenants;
  v_service services;
  v_staff_id uuid;
  v_now timestamptz := now();
  v_today date;
  v_local_date date;
  v_name text;
  v_client_id uuid;
  v_appointment_id uuid;
  v_limit_reason text;
  v_blocked tstzrange;
  v_network_hash text;
  v_replay jsonb;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found
     or not v_tenant.public_booking_enabled
     or v_tenant.suspended_at is not null
     or subscription_expired(v_tenant.paid_until, v_tenant.timezone) then
    return jsonb_build_object('ok', false, 'reason', 'booking_closed');
  end if;

  v_name := btrim(coalesce(p_client_name, ''));
  if v_name = '' or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+381[1-9][0-9]{7,8}$'
     or phone_looks_fake(p_phone_e164) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  -- Tajna dolazi od stranice, ne od čoveka; pogrešan oblik znači grešku u
  -- pozivaocu, a ne termin kome se ne može dokazati vlasništvo.
  if p_manage_proof is not null
     and p_manage_proof !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_proof');
  end if;

  -- Limit po broju se proverava pa tek onda upisuje; bez zaključavanja su
  -- paralelni zahtevi istog broja svi videli isti broj termina i prošli.
  -- Zaključava se samo par salon + broj, i to pre provere ponovljenog zahteva:
  -- zahtev koji je čekao na bravu mora da vidi termin koji je pobednik upravo
  -- upisao, inače bi umesto istog termina dobio odbijenicu.
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant.id::text || ':' || p_phone_e164, 0)
  );

  -- Isti zahtev poslat ponovo (odgovor se izgubio, pa je klijentkinja
  -- pokušala opet) vraća termin koji već postoji. Ovo mora pre limita: inače
  -- bi ponavljanje odmah naišlo na `too_fast` za termin koji je njen.
  v_replay := booking_replay(
    v_tenant.id, p_request_id, p_phone_e164, p_service_id, p_start_at
  );

  if v_replay is not null then
    return v_replay;
  end if;

  v_staff_id := booking_staff_id(v_tenant.id);
  if v_staff_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  select * into v_service
  from services
  where id = p_service_id
    and tenant_id = v_tenant.id
    and active
    and exists (
      select 1 from staff_services ss
      where ss.staff_id = v_staff_id and ss.service_id = services.id
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_service');
  end if;

  -- Korekcija posle roka nije korekcija: na stolici se radi nov set, duži
  -- termin, i sve posle nje kasni. Klijentkinja se šalje na pravu uslugu.
  v_window := service_window_problem(
    v_service.id, p_phone_e164, v_tenant.id, p_start_at
  );

  if v_window is not null then
    return jsonb_build_object('ok', false, 'reason', 'service_window')
      || v_window;
  end if;

  -- Korekcija posle skidanja, ili skidanje pred već zakazanu korekciju.
  v_sequence := service_sequence_problem(
    v_service.id, p_phone_e164, v_tenant.id, p_start_at
  );

  if v_sequence is not null then
    -- Datum u poruci se piše po satu salona, ne servera.
    return jsonb_build_object(
      'ok', false,
      'reason', 'service_sequence',
      'timezone', v_tenant.timezone
    ) || v_sequence;
  end if;

  v_today := (v_now at time zone v_tenant.timezone)::date;
  v_local_date := (p_start_at at time zone v_tenant.timezone)::date;

  if v_local_date < v_today
     or v_local_date > v_today + v_tenant.booking_horizon_days then
    return jsonb_build_object('ok', false, 'reason', 'outside_window');
  end if;

  if p_start_at < v_now + make_interval(mins => v_tenant.min_lead_minutes) then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;

  if not is_bookable_start(
       v_staff_id, v_tenant.timezone, p_start_at, v_service.duration_min
     ) then
    return jsonb_build_object('ok', false, 'reason', 'outside_working_hours');
  end if;

  v_blocked := tstzrange(
    p_start_at, p_start_at + make_interval(mins => v_service.duration_min), '[)'
  );

  if exists (
    select 1 from time_off t
    where t.staff_id = v_staff_id
      and tstzrange(t.start_at, t.end_at, '[)') && v_blocked
  ) then
    return jsonb_build_object('ok', false, 'reason', 'time_off');
  end if;

  v_network_hash := effective_network_hash(v_tenant.id, p_network_hash);

  v_limit_reason := booking_limit_reason(
    v_tenant.id, p_phone_e164, p_start_at, p_device_id, v_network_hash
  );

  if v_limit_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_limit_reason);
  end if;

  perform set_config('app.actor_type', 'client', true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);
  perform set_config('app.network_hash', coalesce(v_network_hash, ''), true);

  -- Dva zahteva za isti termin koji se istovremeno upisuju u ograničenje
  -- preklapanja vide jedan drugog i čekaju jedan na drugog: Postgres posle
  -- sekundu prekine jednog sa `deadlock detected`. Redosled po izvođaču to
  -- sprečava, pa gubitnik odmah dobija `slot_taken`.
  perform pg_advisory_xact_lock(hashtextextended(v_staff_id::text, 1));

  begin
    insert into clients (tenant_id, name, phone_e164)
    values (v_tenant.id, v_name, p_phone_e164)
    on conflict (tenant_id, phone_e164) do nothing;

    select id into v_client_id
    from clients
    where tenant_id = v_tenant.id and phone_e164 = p_phone_e164;

    insert into appointments (
      tenant_id, staff_id, service_id, client_id, start_at,
      duration_min, buffer_after_min, price_rsd, status, source, confirmed_at,
      request_id, manage_proof_hash
    ) values (
      v_tenant.id, v_staff_id, v_service.id, v_client_id, p_start_at,
      v_service.duration_min, 0, v_service.price_rsd,
      'confirmed', 'public', v_now,
      p_request_id, hash_manage_proof(p_manage_proof)
    )
    returning id into v_appointment_id;
  exception when exclusion_violation or unique_violation or deadlock_detected then
    -- Dva istovremena zahteva sa istim `request_id`: gubitnik ne sme da dobije
    -- `slot_taken` za termin koji je upravo njegov.
    v_replay := booking_replay(
      v_tenant.id, p_request_id, p_phone_e164, p_service_id, p_start_at
    );

    if v_replay is not null then
      return v_replay;
    end if;

    if sqlstate not in ('23P01', '40P01') then
      raise;
    end if;

    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end;

  return jsonb_build_object(
    'ok', true,
    'appointment', jsonb_build_object(
      'id', v_appointment_id,
      'tenant_id', v_tenant.id,
      'timezone', v_tenant.timezone,
      'start_at', p_start_at,
      'end_at', p_start_at + make_interval(mins => v_service.duration_min),
      'service_name', v_service.name,
      'price_rsd', v_service.price_rsd
    )
  );
end;
$$;

revoke execute on function
  public_book(text, uuid, timestamptz, text, text, text, text, uuid, text)
  from public, anon, authenticated;

grant execute on function
  public_book(text, uuid, timestamptz, text, text, text, text, uuid, text)
  to service_role;

-- Pregled i otkazivanje ---------------------------------------------------------

drop function public_appointments_for_phone(text, text, text);
drop function public_cancel_appointment(text, text, uuid, text, text);

-- Budući termini koje dati broj i dati dokazi zajedno otvaraju. `null` kad salon
-- ne postoji ili je suspendovan; prazan niz kad ih ništa ne otvara — isto za
-- „pogrešan broj", „pogrešna tajna", „tuđ salon", „prošao" i „otkazan", da
-- odgovor ne otkrije ništa o terminima koje pozivalac ne može da dokaže.
create function public_appointments_for_proof(p_slug text, p_phone_e164 text, p_secrets text[], p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant tenants;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'start_at', a.start_at,
        'end_at', a.end_at,
        'service_name', s.name,
        'price_rsd', a.price_rsd
      )
      order by a.start_at
    )
    from appointments a
    join services s on s.id = a.service_id
    where a.tenant_id = v_tenant.id
      and a.id in (
        select owned_appointment_ids(v_tenant.id, p_phone_e164, p_secrets, p_device_id)
      )
      and a.status in ('pending', 'confirmed')
      and a.start_at >= now()
  ), '[]'::jsonb);
end;
$$;

-- Isti odgovor `not_found` i kad termina nema i kad nije tvoj; ostalo je kao
-- u `20261008000000_cancel_cap_per_phone.sql`.
create function public_cancel_appointment(p_slug text, p_phone_e164 text, p_appointment_id uuid, p_secrets text[], p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text)
 RETURNS jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_cancellations_per_day constant integer := 3;

  v_tenant tenants;
  v_from appointment_status;
  v_client_name text;
  v_service_name text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_network_hash text;
  v_cancelled_today integer;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+381[1-9][0-9]{7,8}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  if not exists (
    select 1
    from owned_appointment_ids(
      v_tenant.id, p_phone_e164, p_secrets, p_device_id
    ) as owned
    where owned = p_appointment_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_network_hash := effective_network_hash(v_tenant.id, p_network_hash);

  -- Isti advisory lock kao u `public_book`: dva istovremena otkazivanja istog
  -- broja ne smeju oba da vide „dva do sada" i prođu.
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant.id::text || ':' || p_phone_e164, 0)
  );

  -- `for update` da dupli dodir na dugme ili dve kartice ne bi otkazale isti
  -- termin dvaput sa dva različita ishoda u audit logu.
  select a.status, a.start_at, a.end_at, c.name, s.name
    into v_from, v_start_at, v_end_at, v_client_name, v_service_name
  from appointments a
  join clients c on c.id = a.client_id
  join services s on s.id = a.service_id
  where a.id = p_appointment_id
    and a.tenant_id = v_tenant.id
  for update of a;

  if v_from in ('cancelled_by_client', 'cancelled_by_salon') then
    return jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  end if;

  if not appointment_status_allowed(v_from, 'cancelled_by_client') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;

  if not exists (
    select 1 from limit_exempt_phones x
    where x.tenant_id = v_tenant.id and x.phone_e164 = p_phone_e164
  ) then
    select count(*) into v_cancelled_today
    from appointment_events e
    join appointments a
      on a.tenant_id = e.tenant_id and a.id = e.appointment_id
    join clients c on c.id = a.client_id
    where e.tenant_id = v_tenant.id
      and c.phone_e164 = p_phone_e164
      and e.actor_type = 'client'
      and e.to_status = 'cancelled_by_client'
      and e.created_at >= now() - interval '24 hours';

    if v_cancelled_today >= c_max_cancellations_per_day then
      return jsonb_build_object('ok', false, 'reason', 'too_many_cancellations');
    end if;
  end if;

  perform set_config('app.actor_type', 'client', true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);
  perform set_config('app.network_hash', coalesce(v_network_hash, ''), true);

  update appointments set status = 'cancelled_by_client'
  where id = p_appointment_id;

  return jsonb_build_object(
    'ok', true,
    'appointment', jsonb_build_object(
      'id', p_appointment_id,
      'tenant_id', v_tenant.id,
      'timezone', v_tenant.timezone,
      'start_at', v_start_at,
      'end_at', v_end_at,
      'client_name', v_client_name,
      'service_name', v_service_name
    )
  );
end;
$$;

revoke execute on function
  public_appointments_for_proof(text, text, text[], text)
  from public, anon, authenticated;

revoke execute on function
  public_cancel_appointment(text, text, uuid, text[], text, text)
  from public, anon, authenticated;

grant execute on function
  public_appointments_for_proof(text, text, text[], text)
  to service_role;

grant execute on function
  public_cancel_appointment(text, text, uuid, text[], text, text)
  to service_role;
