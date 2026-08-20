-- Dve sitnice iz revizije -----------------------------------------------------

-- 1. Ograničenje dnevnika grešaka je bilo zajedničko za sve salone.
--
-- `where occurred_at > now() - interval '1 minute'` nije imalo `tenant_id`, pa
-- je jedan salon u petlji trošio celu kvotu i gasio dnevnik svima ostalima na
-- taj minut. Sad se broji po salonu, uz zajednički krov koji i dalje čuva
-- bazu od navale sa svih strana odjednom.
--
-- Greške bez salona (neprijavljen posetilac na javnoj strani) dele jednu
-- pregradu — njima `tenant_id` ni ne postoji, a i dalje ih treba ograničiti.
create or replace function log_error(
  p_source text,
  p_message text,
  p_digest text default null,
  p_path text default null,
  p_stack text default null,
  p_user_agent text default null,
  p_tenant_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_per_tenant constant integer := 60;
  c_overall constant integer := 300;
begin
  if p_source not in ('client', 'server') then
    return;
  end if;

  if (select count(*) from error_events
      where occurred_at > now() - interval '1 minute'
        and tenant_id is not distinct from p_tenant_id) >= c_per_tenant then
    return;
  end if;

  if (select count(*) from error_events
      where occurred_at > now() - interval '1 minute') >= c_overall then
    return;
  end if;

  insert into error_events
    (source, message, digest, path, stack, user_agent, tenant_id)
  values (
    p_source,
    left(coalesce(nullif(btrim(p_message), ''), 'bez poruke'), 500),
    left(p_digest, 64),
    left(p_path, 300),
    left(p_stack, 8000),
    left(p_user_agent, 300),
    p_tenant_id
  );

  -- Čišćenje bez posebnog posla: evidencija starija od mesec dana nikome ne
  -- treba, a ovako se ne može desiti da se zaboravi da se pusti.
  delete from error_events where occurred_at < now() - interval '30 days';
end;
$$;

revoke execute on function log_error(text, text, text, text, text, text, uuid)
  from public;
grant execute on function log_error(text, text, text, text, text, text, uuid)
  to anon, authenticated;

-- Brojanje po salonu ide kroz indeks koji već postoji samo za `occurred_at`;
-- uz `tenant_id` upit ne mora da čita ceo minut pa da filtrira.
create index if not exists error_events_tenant_occurred_idx
  on error_events (tenant_id, occurred_at desc);

-- 2. Tri funkcije bez `set search_path`.
--
-- Sve tri su `security invoker`, pa je rizik mali — ali nijedna `security
-- definer` funkcija u šemi nije bez njega, i nema razloga da ove tri jedine
-- bućkaju Supabase-ov savetnik.
alter function add_minutes(timestamptz, integer) set search_path = public;
alter function set_updated_at() set search_path = public;
alter function appointment_status_allowed(appointment_status, appointment_status)
  set search_path = public;
