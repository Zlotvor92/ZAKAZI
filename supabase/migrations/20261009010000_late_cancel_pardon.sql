-- Salon oprašta kasna otkazivanja ---------------------------------------------
--
-- `20261009000000_late_cancel_strikes.sql` zaključava samostalno zakazivanje
-- posle dva kasna otkazivanja, a jedini izlaz je bio ručni unos termina. Ovo
-- daje salonu dugme „Oprosti" na kartici klijentkinje.
--
-- Oproštaj ne briše ništa: audit log ostaje nedirnut. U `late_cancel_pardons`
-- se upiše red (salon, broj, ko, kada), a brojač od tada broji samo kasna
-- otkazivanja POSLE poslednjeg oproštaja. Red se ne menja ni briše (nema
-- politike za izmenu i brisanje), pa se vidi ko je i kada oprostio.
--
-- Oproštaj važi po salonu i po broju, kao i brojač. Salon ne može da oprosti
-- tuđi broj: politika proverava članstvo, a funkcija broj čita iz klijentkinje
-- koju RLS pokaže samo članu salona.

create table late_cancel_pardons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone_e164 text not null
    check (phone_e164 ~ '^\+381[1-9][0-9]{7,8}$'),
  created_by uuid references auth.users (id) on delete set null,
  -- Isti izvor vremena kao `appointment_events` (vidi 20260816220000): `now()`
  -- bi oproštaj ubacio pre otkazivanja iz iste transakcije.
  created_at timestamptz not null default clock_timestamp()
);

create index late_cancel_pardons_phone_idx
  on late_cancel_pardons (tenant_id, phone_e164, created_at desc);

alter table late_cancel_pardons enable row level security;

create policy late_cancel_pardons_select on late_cancel_pardons
  for select to authenticated using (is_tenant_member(tenant_id));
create policy late_cancel_pardons_insert on late_cancel_pardons
  for insert to authenticated with check (is_tenant_member(tenant_id));

-- Neulogovani posetilac ne sme ni da pita; izmena i brisanje ne postoje.
revoke all on late_cancel_pardons from public, anon;
revoke update, delete on late_cancel_pardons from authenticated;

-- Prag na jednom mestu, da `booking_limit_reason` i kartica ne mogu da se
-- razidju.
create function late_cancel_limit() returns integer
language sql
immutable
as $$
  select 2;
$$;

-- Kasna otkazivanja broja u salonu od poslednjeg oproštaja. Bez
-- `security definer`: RLS bira događaje i oproštaje, pa član jednog salona
-- za tuđ salon dobija nulu. `booking_limit_reason` radi kao vlasnik i vidi sve.
create function late_cancellation_count(p_tenant_id uuid, p_phone_e164 text)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from appointment_events e
  join appointments a
    on a.tenant_id = e.tenant_id and a.id = e.appointment_id
  join clients c on c.id = a.client_id
  where e.tenant_id = p_tenant_id
    and c.phone_e164 = p_phone_e164
    and e.actor_type = 'client'
    and e.to_status = 'cancelled_by_client'
    and a.start_at < e.created_at + interval '24 hours'
    and e.created_at > coalesce((
      select max(p.created_at)
      from late_cancel_pardons p
      where p.tenant_id = p_tenant_id and p.phone_e164 = p_phone_e164
    ), '-infinity'::timestamptz);
$$;

revoke execute on function late_cancel_limit(), late_cancellation_count(uuid, text)
  from public, anon;
grant execute on function late_cancel_limit(), late_cancellation_count(uuid, text)
  to authenticated;

-- Oprosti kasna otkazivanja broja klijentkinje. Ništa se ne upisuje kad nema
-- šta da se oprosti.
create function pardon_late_cancellations(p_client_id uuid) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_client clients;
begin
  select * into v_client from clients where id = p_client_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if late_cancellation_count(v_client.tenant_id, v_client.phone_e164) > 0 then
    insert into late_cancel_pardons (tenant_id, phone_e164, created_by)
    values (v_client.tenant_id, v_client.phone_e164, auth.uid());
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function pardon_late_cancellations(uuid) from public, anon;
grant execute on function pardon_late_cancellations(uuid) to authenticated;

-- Kartica dobija broj kasnih otkazivanja i da li je zakazivanje zaključano.
create or replace function client_card(p_appointment_id uuid) returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'client_id', c.id,
    'name', c.name,
    'phone_e164', c.phone_e164,
    'notes', c.notes,
    'first_seen', c.created_at,
    'completed', count(*) filter (where h.status = 'completed'),
    'no_show', count(*) filter (where h.status = 'no_show'),
    'cancelled_by_client', count(*) filter (where h.status = 'cancelled_by_client'),
    'cancelled_by_salon', count(*) filter (where h.status = 'cancelled_by_salon'),
    'upcoming', count(*) filter (
      where h.status in ('pending', 'confirmed') and h.start_at >= now()
    ),
    'last_visit', max(h.start_at) filter (where h.status = 'completed'),
    'blocked', exists (
      select 1 from blocklist b
      where b.tenant_id = c.tenant_id and b.phone_e164 = c.phone_e164
    ),
    'late_cancellations', late_cancellation_count(c.tenant_id, c.phone_e164),
    'late_cancel_locked',
      late_cancellation_count(c.tenant_id, c.phone_e164) >= late_cancel_limit()
  )
  from appointments a
  join clients c on c.id = a.client_id
  join appointments h on h.client_id = c.id
  where a.id = p_appointment_id
  group by c.id
$$;

-- `booking_limit_reason`: isto telo kao u `20261009000000_late_cancel_strikes.sql`,
-- novo je samo to što brojač i prag dolaze iz zajedničkih funkcija, pa
-- oproštaj važi.

CREATE OR REPLACE FUNCTION public.booking_limit_reason(p_tenant_id uuid, p_phone_e164 text, p_start_at timestamp with time zone, p_device_id text, p_network_hash text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_week_days constant integer := 7;
  c_max_per_week constant integer := 2;
  c_max_upcoming_new constant integer := 4;
  c_max_upcoming_known constant integer := 6;
  c_max_upcoming_device constant integer := 6;
  c_cooldown_seconds constant integer := 30;
  c_network_window_minutes constant integer := 60;
  c_max_per_network constant integer := 8;

  v_now timestamptz := now();
  v_known_client boolean;
  v_max_upcoming integer;
  v_count integer;
  v_last_booking timestamptz;
  v_network_hash text;
begin
  if exists (
    select 1 from blocklist b
    where b.tenant_id = p_tenant_id and b.phone_e164 = p_phone_e164
  ) then
    return 'blocked';
  end if;

  if exists (
    select 1 from limit_exempt_phones x
    where x.tenant_id = p_tenant_id and x.phone_e164 = p_phone_e164
  ) then
    return null;
  end if;

  if late_cancellation_count(p_tenant_id, p_phone_e164) >= late_cancel_limit() then
    return 'too_many_late_cancellations';
  end if;

  select count(*) into v_count
  from appointments a
  join clients c on c.id = a.client_id
  where a.tenant_id = p_tenant_id
    and c.phone_e164 = p_phone_e164
    and a.status in ('pending', 'confirmed')
    and a.start_at >= v_now
    and a.start_at between p_start_at - make_interval(days => c_week_days)
                       and p_start_at + make_interval(days => c_week_days);

  if v_count >= c_max_per_week then
    return 'too_many_this_week';
  end if;

  select exists (
    select 1
    from appointments a
    join clients c on c.id = a.client_id
    where a.tenant_id = p_tenant_id
      and c.phone_e164 = p_phone_e164
      and a.status = 'completed'
  ) into v_known_client;

  select count(*) into v_count
  from appointments a
  join clients c on c.id = a.client_id
  where a.tenant_id = p_tenant_id
    and c.phone_e164 = p_phone_e164
    and a.status in ('pending', 'confirmed')
    and a.start_at >= v_now;

  v_max_upcoming := case
    when v_known_client then c_max_upcoming_known
    else c_max_upcoming_new
  end;

  if v_count >= v_max_upcoming then
    return 'too_many_upcoming';
  end if;

  v_network_hash := effective_network_hash(p_tenant_id, p_network_hash);

  if v_network_hash is not null then
    select count(*) into v_count
    from appointment_events e
    where e.tenant_id = p_tenant_id
      and e.network_hash = v_network_hash
      and e.from_status is null
      and e.created_at >= v_now
                        - make_interval(mins => c_network_window_minutes);

    if v_count >= c_max_per_network then
      return 'too_many_from_network';
    end if;
  end if;

  if p_device_id is null or p_device_id = '' then
    return null;
  end if;

  select count(*), max(e.created_at)
    into v_count, v_last_booking
  from appointment_events e
  join appointments a on a.id = e.appointment_id
  where e.tenant_id = p_tenant_id
    and e.device_id = p_device_id
    and e.from_status is null
    and a.status in ('pending', 'confirmed')
    and a.start_at >= v_now;

  if v_count >= c_max_upcoming_device then
    return 'too_many_from_device';
  end if;

  if v_last_booking is not null
     and v_last_booking > v_now - make_interval(secs => c_cooldown_seconds) then
    return 'too_fast';
  end if;

  return null;
end;
$function$;
