-- Salon sam blokira broj telefona.
--
-- Ovo je jače od svih limita zajedno, jer stvarna pretnja nije botnet nego
-- jedna uporna osoba. Limiti je usporavaju, blokada je zaustavlja.

create table blocklist (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone_e164 text not null,
  reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint blocklist_phone_e164_format
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint blocklist_tenant_id_phone_key unique (tenant_id, phone_e164)
);

create index blocklist_tenant_id_idx on blocklist (tenant_id);

alter table blocklist enable row level security;

create policy blocklist_select on blocklist
  for select to authenticated using (is_tenant_member(tenant_id));
create policy blocklist_insert on blocklist
  for insert to authenticated with check (is_tenant_member(tenant_id));
-- Odblokiranje je brisanje reda. Izmene nema — razlog blokade se ne prepravlja
-- naknadno, nego se broj odblokira pa po potrebi blokira iznova.
create policy blocklist_delete on blocklist
  for delete to authenticated using (is_tenant_member(tenant_id));

create or replace function booking_limit_reason(
  p_tenant_id uuid,
  p_phone_e164 text,
  p_start_at timestamptz,
  p_device_id text
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Najviše dva termina u nedelji oko traženog datuma. Ko dolazi svake nedelje
  -- ovo ne oseti: termini od pre i posle sedam dana ne ulaze u isti prozor.
  c_week_days constant integer := 7;
  c_max_per_week constant integer := 2;

  -- Gornja granica za sve buduće termine, da se dvadeset rezervacija ne
  -- razmaže po tri meseca i tako zaobiđe nedeljni limit.
  c_max_upcoming_new constant integer := 4;
  c_max_upcoming_known constant integer := 6;

  -- Isti uređaj, bez obzira koliko je različitih brojeva upisao.
  c_max_upcoming_device constant integer := 6;
  c_cooldown_seconds constant integer := 30;

  v_now timestamptz := now();
  v_known_client boolean;
  v_max_upcoming integer;
  v_count integer;
  v_last_booking timestamptz;
begin
  -- Prvo i najjeftinije: blokiran broj ne prolazi dalje.
  if exists (
    select 1 from blocklist b
    where b.tenant_id = p_tenant_id and b.phone_e164 = p_phone_e164
  ) then
    return 'blocked';
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

  -- Ko je već dolazio nije nepoznat broj. Trenje raste sa rizikom, a ne sa
  -- brojem termina — zato stalna mušterija sme više. Broji se samo `completed`:
  -- ko nije došao ne postaje poznat.
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

  -- Izdvojeno u promenljivu namerno: `if` u plpgsql-u čita uslov do prvog
  -- `then`, pa bi `case ... then ... end` unutar uslova prekinuo izraz.
  v_max_upcoming := case
    when v_known_client then c_max_upcoming_known
    else c_max_upcoming_new
  end;

  if v_count >= v_max_upcoming then
    return 'too_many_upcoming';
  end if;

  if p_device_id is null or p_device_id = '' then
    return null;
  end if;

  -- Uređaj se čita iz istorije promena, jer je red o nastanku termina
  -- (`from_status is null`) jedino mesto gde uređaj i stoji.
  select count(*), max(e.created_at)
    into v_count, v_last_booking
  from appointment_events e
  join appointments a
    on a.tenant_id = e.tenant_id and a.id = e.appointment_id
  where e.tenant_id = p_tenant_id
    and e.device_id = p_device_id
    and e.from_status is null
    and a.status in ('pending', 'confirmed')
    and a.start_at >= v_now;

  if v_count >= c_max_upcoming_device then
    return 'too_many_from_device';
  end if;

  -- Čovek ne popuni dva puta formu za trideset sekundi; skripta popuni.
  if v_last_booking is not null
     and v_last_booking > v_now - make_interval(secs => c_cooldown_seconds) then
    return 'too_fast';
  end if;

  return null;
end;
$$;
