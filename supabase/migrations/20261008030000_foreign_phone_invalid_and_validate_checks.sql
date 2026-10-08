-- Strani broj u ručnom unosu vraća `invalid_phone`; potvrda telefonskih provera --
--
-- 1. `create_appointment` je primao svaki međunarodni broj (`^\+[1-9][0-9]{7,14}$`),
--    a tabela `clients` dozvoljava samo srpske (`clients_phone_e164_format`). Strani
--    broj je zato prolazio funkciju i padao na ograničenju sa SQL greškom 23514
--    umesto sa strukturiranim `invalid_phone`. Forma takav broj ionako filtrira
--    (`normalizePhone`), pa ovo samo usklađuje ugovor funkcije sa tabelom.
--
-- 2. `clients_phone_e164_format`, `limit_exempt_phones_phone_e164_check` i
--    `push_subscriptions_endpoint_allowed` su napravljeni sa `not valid`: važe za
--    nove i izmenjene redove, a postojeće ne proveravaju. Ovde se potvrđuju, ali
--    samo ako nijedan postojeći red ne krši pravilo — inače bi migracija pala i
--    zaustavila sve ostale posle nje. Ako ima prekršilaca, ograničenje ostaje
--    `not valid`, a migracija to javlja porukom; redovi se tada ispravljaju ručno
--    (upit je u 20260928050000 i 20261008010000), pa se `validate` pokreće ručno.

create or replace function create_appointment(
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

  if coalesce(p_phone_e164, '') !~ '^\+381[1-9][0-9]{7,8}$' then
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


do $$
begin
  if not exists (
    select 1 from clients where phone_e164 !~ '^\+381[1-9][0-9]{7,8}$'
  ) then
    alter table clients validate constraint clients_phone_e164_format;
  else
    raise notice 'clients_phone_e164_format ostaje not valid: postoje redovi koji ga krše';
  end if;

  if not exists (
    select 1 from limit_exempt_phones
    where phone_e164 !~ '^\+381[1-9][0-9]{7,8}$'
  ) then
    alter table limit_exempt_phones
      validate constraint limit_exempt_phones_phone_e164_check;
  else
    raise notice 'limit_exempt_phones_phone_e164_check ostaje not valid: postoje redovi koji ga krše';
  end if;

  if not exists (
    select 1 from push_subscriptions
    where endpoint !~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/'
  ) then
    alter table push_subscriptions
      validate constraint push_subscriptions_endpoint_allowed;
  else
    raise notice 'push_subscriptions_endpoint_allowed ostaje not valid: postoje redovi koji ga krše';
  end if;
end;
$$;
