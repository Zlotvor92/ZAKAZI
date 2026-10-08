-- Samootkazivanje preko sajta najkasnije 24 sata pre termina ----------------
--
-- Termin otkazan par sati ranije ostaje prazan. Posle praga sajt odbija sa
-- razlogom `too_late` (aplikacija sama ispisuje poruku), a spisak termina
-- vraća `cancellable` da ekran ne nudi dugme koje ne radi. Salon i dalje
-- otkazuje iz kalendara u svako doba. Isti potpisi kao ranije.

create or replace function public_appointments_for_proof(p_slug text, p_phone_e164 text, p_secrets text[], p_device_id text DEFAULT NULL::text)
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
        'price_rsd', a.price_rsd,
        'cancellable', a.start_at >= now() + interval '24 hours'
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
create or replace function public_cancel_appointment(p_slug text, p_phone_e164 text, p_appointment_id uuid, p_secrets text[], p_device_id text DEFAULT NULL::text, p_network_hash text DEFAULT NULL::text)
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

  -- Otkazivanje 2 sata pred termin ostavlja prazan sat koji niko ne može da
  -- popuni. Preko sajta se otkazuje najkasnije 24 sata unapred; posle toga
  -- samo salon.
  if v_start_at < now() + interval '24 hours' then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
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

