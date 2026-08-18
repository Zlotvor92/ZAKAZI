-- Uvid u termine i otkazivanje preko broja telefona (`/otkazi`) do sada nisu
-- imali nikakvo ograničenje brzine — dok zakazivanje ima granicu po mreži i
-- uređaju, ovde je i dalje bilo namerno (vidi 20260817000000) da sam broj
-- telefona dovoljno dokazuje da je termin tvoj, jer puna SMS potvrda čeka
-- Fazu 3/4. Ta odluka ostaje. Ono što ne treba da ostane je da se brojevi
-- mogu pogađati bez ijednog usporavanja: 25 poziva u par sekundi je danas
-- prošlo bez traga. Ovo dodaje istu vrstu granice po mreži koju zakazivanje
-- već ima, ne i traženu potvrdu — to je i dalje van dosega ove izmene.

create table phone_lookup_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  network_hash text not null,
  created_at timestamptz not null default now()
);

comment on table phone_lookup_attempts is
  'Svaki pokušaj čitanja ili otkazivanja termina preko broja telefona, radi ograničenja brzine. Ne čuva ni broj ni razlog poziva.';

create index phone_lookup_attempts_network_idx
  on phone_lookup_attempts (tenant_id, network_hash, created_at desc);

alter table phone_lookup_attempts enable row level security;

create function phone_lookup_limit_reason(p_tenant_id uuid, p_network_hash text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_window_minutes constant integer := 60;
  c_max_per_network constant integer := 20;
  v_count integer;
begin
  -- Nema ni klijentovu ni Kong-ovu adresu: nema šta da se broji, pa se ne
  -- rizikuje da se stalna mušterija odbije zbog tuđih pokušaja.
  if p_network_hash is null then
    return null;
  end if;

  select count(*) into v_count
  from phone_lookup_attempts
  where tenant_id = p_tenant_id
    and network_hash = p_network_hash
    and created_at >= now() - make_interval(mins => c_window_minutes);

  if v_count >= c_max_per_network then
    return 'too_many_lookups';
  end if;

  return null;
end;
$$;

revoke execute on function phone_lookup_limit_reason(uuid, text) from public, anon;

-- Čitanje termina po broju ---------------------------------------------------

create or replace function public_appointments_for_phone(
  p_slug text,
  p_phone_e164 text,
  p_network_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant tenants;
  v_network_hash text;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return null;
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return '[]'::jsonb;
  end if;

  v_network_hash := effective_network_hash(v_tenant.id, p_network_hash);
  insert into phone_lookup_attempts (tenant_id, network_hash)
  values (v_tenant.id, coalesce(v_network_hash, 'unknown'));

  -- Namerno ista prazna lista kao za "taj broj nema termina": ko pogađa
  -- brojeve ne sme da vidi razliku između "nema termina" i "prebrzo pokušavaš".
  if phone_lookup_limit_reason(v_tenant.id, v_network_hash) is not null then
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

drop function if exists public_appointments_for_phone(text, text);

revoke execute on function
  public_appointments_for_phone(text, text, text)
  from public;
grant execute on function
  public_appointments_for_phone(text, text, text)
  to anon, authenticated;

-- Otkazivanje -----------------------------------------------------------------

create or replace function public_cancel_appointment(
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
  v_network_hash text;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or v_tenant.suspended_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
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
$$;

revoke execute on function
  public_cancel_appointment(text, text, uuid, text, text)
  from public;
grant execute on function
  public_cancel_appointment(text, text, uuid, text, text)
  to anon, authenticated;
