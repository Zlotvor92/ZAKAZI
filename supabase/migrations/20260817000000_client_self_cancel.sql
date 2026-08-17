-- Klijentkinja sama otkazuje termin koji je zakazala.
--
-- Nema naloga, pa nema šta da je uloguje. Umesto toga dokazuje da je njen
-- termin brojem telefona sa kog je zakazala — isti identitet koji već nosi
-- kroz ceo sistem (`clients.phone_e164`). Bez SMS potvrde bilo ko ko zna taj
-- broj može da otkaže termin; to je namerna odluka, ne previd — puna potvrda
-- porukom čeka Fazu 3/4, isto kao i zaštita od lažnih brojeva.
--
-- Prekidač `public_booking_enabled` gasi NOVA zakazivanja, ne postojeća. Ova
-- strana zato proverava samo da salon postoji i nije suspendovan, kao
-- suspenzija koja gasi javnu stranu u celini.

-- Ono što stranica za otkazivanje pokaže pre nego što zna telefon: ime, boje,
-- logo. Odvojeno od `public_booking_data` jer to vraća `null` i kad je
-- zakazivanje ručno isključeno, a otkazivanje tada i dalje sme da radi.
create function public_salon_summary(p_slug text) returns jsonb
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

  return jsonb_build_object(
    'name', v_tenant.name,
    'slug', v_tenant.slug,
    'timezone', v_tenant.timezone,
    'brand_background', v_tenant.brand_background,
    'brand_primary', v_tenant.brand_primary,
    'brand_accent', v_tenant.brand_accent,
    'logo_url', v_tenant.logo_url
  );
end;
$$;

revoke execute on function public_salon_summary(text) from public;
grant execute on function public_salon_summary(text) to anon, authenticated;

-- Budući termini za dati broj, da klijentkinja izabere koji otkazuje. Samo
-- `pending`/`confirmed`: otkazan ili završen termin nema šta da se otkaže.
create function public_appointments_for_phone(
  p_slug text,
  p_phone_e164 text
) returns jsonb
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

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return '[]'::jsonb;
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
    join clients c on c.id = a.client_id
    join services s on s.id = a.service_id
    where a.tenant_id = v_tenant.id
      and c.phone_e164 = p_phone_e164
      and a.status in ('pending', 'confirmed')
      and a.start_at >= now()
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public_appointments_for_phone(text, text) from public;
grant execute on function public_appointments_for_phone(text, text)
  to anon, authenticated;

-- Samo otkazivanje. Isti prelaz koji koristi i `change_appointment_status`,
-- pa triger nad `appointments` upiše trag kao za svaku drugu promenu — ovde
-- se samo označava da je akter klijent, ne vlasnica.
create function public_cancel_appointment(
  p_slug text,
  p_phone_e164 text,
  p_appointment_id uuid,
  p_device_id text default null,
  p_network_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant tenants;
  v_from appointment_status;
  v_client_name text;
  v_service_name text;
  v_start_at timestamptz;
  v_end_at timestamptz;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
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

  if not appointment_status_allowed(v_from, 'cancelled_by_client') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;

  perform set_config('app.actor_type', 'client', true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);
  perform set_config('app.network_hash', coalesce(p_network_hash, ''), true);

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
  public_cancel_appointment(text, text, uuid, text, text)
  from public;
grant execute on function
  public_cancel_appointment(text, text, uuid, text, text)
  to anon, authenticated;
