-- Obaveštenje o novom zakazivanju.
--
-- Kanal je Web Push: prava notifikacija na telefonu i kad je aplikacija
-- zatvorena, bez cene po poruci. Pri dvesta zakazivanja mesečno SMS bi pojeo
-- pola pretplate od 990 dinara, pa cena ovde nije sitnica nego izbor kanala.

/*
 * Telefoni koji primaju obaveštenja.
 *
 * `endpoint` je tajna: ko ga ima, uz ključeve, može da joj šalje notifikacije.
 * Zato politike ne gledaju članstvo u salonu nego samog korisnika — svako vidi
 * i briše isključivo svoje uređaje. Ni vlasnik platforme ne čita tuđe.
 */
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_tenant_id_idx on push_subscriptions (tenant_id);

alter table push_subscriptions enable row level security;

create policy push_subscriptions_select on push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_subscriptions_insert on push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and is_tenant_member(tenant_id));

create policy push_subscriptions_delete on push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

/*
 * Svaka poslata poruka.
 *
 * Push ne košta ništa, ali se svejedno upisuje: bez ovoga se na pitanje „zašto
 * mi nije stiglo obaveštenje" nema šta odgovoriti, a marža po nalogu se ne
 * računa kad se doda kanal koji košta.
 *
 * Nema politiku za upis. Poruke upisuje isključivo server preko `service_role`,
 * pa se red u ovoj tabeli ne može podmetnuti kroz API.
 */
create table messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  appointment_id uuid references appointments (id) on delete set null,
  channel text not null,
  template text not null,
  to_phone text,
  status text not null,
  cost_estimate numeric(10, 4) not null default 0,
  sent_at timestamptz not null default now(),
  constraint messages_channel_known check (channel in ('push', 'sms', 'viber', 'email')),
  constraint messages_status_known check (status in ('sent', 'failed', 'expired')),
  constraint messages_cost_not_negative check (cost_estimate >= 0)
);

create index messages_tenant_id_sent_at_idx on messages (tenant_id, sent_at desc);

alter table messages enable row level security;

create policy messages_select on messages
  for select to authenticated
  using (is_tenant_member(tenant_id));

-- Zakazivanje kaže i čiji je salon --------------------------------------

-- Server posle uspešnog zakazivanja mora da zna kome da javi. Slug ima, ali
-- `tenants` po RLS-u ne čita niko neulogovan, i to ostaje tako.
create or replace function public_book(
  p_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_client_name text,
  p_phone_e164 text,
  p_device_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or not v_tenant.public_booking_enabled then
    return jsonb_build_object('ok', false, 'reason', 'booking_closed');
  end if;

  v_name := btrim(coalesce(p_client_name, ''));
  if v_name = '' or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
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

  v_today := (v_now at time zone v_tenant.timezone)::date;
  v_local_date := (p_start_at at time zone v_tenant.timezone)::date;

  if v_local_date < v_today
     or v_local_date > v_today + v_tenant.booking_horizon_days then
    return jsonb_build_object('ok', false, 'reason', 'outside_window');
  end if;

  if p_start_at < v_now + make_interval(mins => v_tenant.min_lead_minutes) then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;

  if not is_bookable_start(v_staff_id, v_tenant.timezone, p_start_at) then
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

  v_limit_reason := booking_limit_reason(
    v_tenant.id, p_phone_e164, p_start_at, p_device_id
  );

  if v_limit_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_limit_reason);
  end if;

  perform set_config('app.actor_type', 'client', true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);

  begin
    insert into clients (tenant_id, name, phone_e164)
    values (v_tenant.id, v_name, p_phone_e164)
    on conflict (tenant_id, phone_e164) do nothing;

    select id into v_client_id
    from clients
    where tenant_id = v_tenant.id and phone_e164 = p_phone_e164;

    insert into appointments (
      tenant_id, staff_id, service_id, client_id, start_at,
      duration_min, buffer_after_min, price_rsd, status, source, confirmed_at
    ) values (
      v_tenant.id, v_staff_id, v_service.id, v_client_id, p_start_at,
      v_service.duration_min, 0, v_service.price_rsd,
      'confirmed', 'public', v_now
    )
    returning id into v_appointment_id;
  exception when exclusion_violation then
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
