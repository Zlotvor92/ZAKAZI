-- Evidencija grešaka --------------------------------------------------------
--
-- Za jutrošnji beli ekran se saznalo tako što je vlasnica platforme sama
-- probala prijavu. Sa dvadeset salona koji plaćaju, za kvar se saznaje iz
-- ljute poruke ili nikako — žena ne zove, nego prestane da plaća.
--
-- `tenant_id` je ovde jedini u bazi koji sme da bude prazan, i to namerno:
-- greška na strani za prijavu ili na početnoj ne pripada nijednom salonu, a
-- baš te greške najviše bole. Tabela zato nije podatak korisnika nego
-- telemetrija platforme, i čita je isključivo vlasnik platforme.

create table error_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  source text not null,
  message text not null,
  digest text,
  path text,
  stack text,
  user_agent text,
  tenant_id uuid references tenants (id) on delete set null,
  constraint error_events_source_known check (source in ('client', 'server')),
  -- Bez gornje granice jedan zapetljan stek trag ume da bude više stotina
  -- kilobajta, a od toga posle stotog reda niko ništa ne pročita.
  constraint error_events_message_length check (length(message) <= 500),
  constraint error_events_stack_length check (stack is null or length(stack) <= 8000)
);

-- Spisak se uvek gleda od najnovije.
create index error_events_occurred_at_idx on error_events (occurred_at desc);

alter table error_events enable row level security;

-- Nema politike za `select`: red vidi samo `security definer` funkcija ispod,
-- koja pre čitanja pita ko zove. Salon ne sme da vidi ni svoje greške — u
-- steku ume da završi put do tuđeg salona.
revoke all on table error_events from anon, authenticated;

/**
 * Upis greške.
 *
 * Zove je i neprijavljen posetilac, jer greška na javnoj strani zakazivanja
 * pogađa upravo njega. Zato ovde nema ničega što bi se moglo zloupotrebiti:
 * tekst se seče, a preko šezdeset upisa u minutu se tiho odbacuje, da neko
 * ne bi napunio bazu pozivajući funkciju u petlji.
 *
 * Vraća `void` namerno — pozivalac ne sme da sazna da li je upis prošao,
 * a i da sazna ne bi znao šta s tim.
 */
create function log_error(
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
begin
  if p_source not in ('client', 'server') then
    return;
  end if;

  if (select count(*) from error_events
      where occurred_at > now() - interval '1 minute') >= 60 then
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

/** Poslednje greške, za konzolu. Praznu listu dobija svako ko ne upravlja platformom. */
create function recent_errors(p_limit integer default 50)
returns table (
  id uuid,
  occurred_at timestamptz,
  source text,
  message text,
  path text,
  stack text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.occurred_at, e.source, e.message, e.path, e.stack
  from error_events e
  where is_platform_owner()
  order by e.occurred_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke execute on function recent_errors(integer) from public, anon;
grant execute on function recent_errors(integer) to authenticated;

/** Koliko je grešaka bilo u poslednja 24 sata — za traku u konzoli. */
create function error_count_last_day() returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when is_platform_owner() then (
      select count(*)::int from error_events
      where occurred_at > now() - interval '24 hours'
    )
    else 0
  end;
$$;

revoke execute on function error_count_last_day() from public, anon;
grant execute on function error_count_last_day() to authenticated;
