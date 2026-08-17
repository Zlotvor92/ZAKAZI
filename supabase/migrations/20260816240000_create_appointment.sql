-- Termin koji vlasnica unosi sama.
--
-- Namerno bez ijednog ograničenja koje važi za javnu stranicu: sme van radnog
-- vremena, van mreže od petnaest minuta, bez najranijeg termina i preko svih
-- limita. Klijentkinja koja moli za 21h nije zloupotreba nego posao, a
-- kalendar pripada vlasnici. Blokiran broj isto prolazi — blokada znači da taj
-- broj ne može sam preko interneta, ne da ga salon ne sme primiti.
--
-- Jedino što je zaustavlja je dupla rezervacija, i to zaustavlja baza.
--
-- Bez `security definer`: RLS bira i uslugu i izvođača i klijenta, pa vlasnica
-- jednog salona ovim ne može da upiše ništa u tuđi.
create function create_appointment(
  p_service_id uuid,
  p_start_at timestamptz,
  p_client_name text,
  p_phone_e164 text,
  p_device_id text default null
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
begin
  v_name := btrim(coalesce(p_client_name, ''));
  if v_name = '' or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  select * into v_service
  from services
  where id = p_service_id and active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_service');
  end if;

  -- Isti redosled kao `booking_staff_id`, da javna stranica i vlasnica nikad
  -- ne upisuju kod različitih izvođača.
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
      duration_min, buffer_after_min, price_rsd, status, source, confirmed_at
    ) values (
      v_service.tenant_id, v_staff_id, v_service.id, v_client_id, p_start_at,
      v_service.duration_min, v_service.buffer_after_min, v_service.price_rsd,
      'confirmed', 'salon', now()
    )
    returning id into v_appointment_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end;

  return jsonb_build_object('ok', true, 'appointment_id', v_appointment_id);
end;
$$;

revoke execute on function create_appointment(uuid, timestamptz, text, text, text)
  from public, anon;
grant execute on function create_appointment(uuid, timestamptz, text, text, text)
  to authenticated;

-- Usluge salona za spisak u interfejsu.
create function tenant_services() returns table (
  id uuid,
  name text,
  duration_min integer,
  buffer_after_min integer,
  price_rsd integer
)
language sql
stable
set search_path = public
as $$
  select id, name, duration_min, buffer_after_min, price_rsd
  from services
  where active
  order by name
$$;

revoke execute on function tenant_services() from public, anon;
grant execute on function tenant_services() to authenticated;
