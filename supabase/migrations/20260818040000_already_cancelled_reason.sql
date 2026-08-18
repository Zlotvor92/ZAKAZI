-- Otkazivanje već otkazanog termina je do sada davalo `invalid_transition`,
-- što se na strani prevodi u „Taj termin se više ne može otkazati preko
-- sajta. Javi se salonu." — a termin je otkazan, klijentkinja je dobila
-- tačno ono što je htela. Dešava se kad je strana otvorena u dve kartice ili
-- kad se dugme dodirne dvaput.
--
-- `completed` i `no_show` i dalje daju `invalid_transition`: tu je poruka
-- tačna, termin je prošao i sajt zaista ne može ništa.

create or replace function public_cancel_appointment(p_slug text, p_phone_e164 text, p_appointment_id uuid, p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant tenants;
  v_from appointment_status;
  v_client_name text;
  v_service_name text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_network_hash text;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+381[0-9]{8,9}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  v_network_hash := effective_network_hash(v_tenant.id, p_network_hash);
  insert into phone_lookup_attempts (tenant_id, network_hash)
  values (v_tenant.id, coalesce(v_network_hash, 'unknown'));

  if phone_lookup_limit_reason(v_tenant.id, v_network_hash) is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- `for update` da dupli dodir na dugme ili dve kartice ne bi otkazale isti
  -- termin dvaput sa dva različita ishoda u audit logu.
  select a.status, a.start_at, a.end_at, c.name, s.name
    into v_from, v_start_at, v_end_at, v_client_name, v_service_name
  from appointments a
  join clients c on c.id = a.client_id
  join services s on s.id = a.service_id
  where a.id = p_appointment_id
    and a.tenant_id = v_tenant.id
    and c.phone_e164 = p_phone_e164
  for update of a;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_from in ('cancelled_by_client', 'cancelled_by_salon') then
    return jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  end if;

  if not appointment_status_allowed(v_from, 'cancelled_by_client') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
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
$function$;
