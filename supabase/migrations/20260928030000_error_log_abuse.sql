-- Evidencija grešaka ne sme da se puni spolja ------------------------------------
--
-- Do sada je `log_error` mogla da zove `anon` rola: 60 upisa u minutu iz jedne
-- deljene kofe, do 8.000 znakova stack-a po redu. Napadač je tako punio bazu
-- (oko 690 MB dnevno) i istiskivao prave greške servera iz kofe.
--
--  * `log_error` sada zove samo server (`service_role`). Pregledač šalje grešku
--    ruti `/api/greske`, a ona upisuje sa izvorom `client`; izvor `server`
--    postavlja samo kod na serveru, pa se ne može podmetnuti spolja.
--  * Kofe su odvojene po izvoru: klijentskih najviše 10 u minutu, serverskih
--    60. Poplava klijentskih ne dira serverske.
--  * Tekst se seče: poruka 300, stack 2.000, putanja 200, user agent 200.
--  * Poznati lični podaci se brišu pre upisa: mejl adrese, nizovi od devet i
--    više cifara (brojevi telefona) i UUID-ovi (token kalendara, id termina).
--  * Čuva se 7 dana umesto 30.

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
  c_client_per_minute constant integer := 10;
  c_server_per_minute constant integer := 60;
  v_limit integer;
begin
  if p_source not in ('client', 'server') then
    return;
  end if;

  v_limit := case p_source
    when 'client' then c_client_per_minute
    else c_server_per_minute
  end;

  if (select count(*) from error_events
      where source = p_source
        and occurred_at > now() - interval '1 minute') >= v_limit then
    return;
  end if;

  insert into error_events
    (source, message, digest, path, stack, user_agent, tenant_id)
  values (
    p_source,
    left(coalesce(nullif(btrim(scrub_error_text(p_message)), ''), 'bez poruke'), 300),
    left(p_digest, 64),
    left(scrub_error_text(p_path), 200),
    left(scrub_error_text(p_stack), 2000),
    left(p_user_agent, 200),
    p_tenant_id
  );

  delete from error_events where occurred_at < now() - interval '7 days';
end;
$$;

-- Briše ono što u tekstu greške sme da bude lično. Čista funkcija, bez
-- pristupa tabelama.
create function scrub_error_text(p_text text) returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               p_text,
               '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[mejl]', 'g'),
             '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
             '[uuid]', 'g'),
           '\+?[0-9](?:[ ()./-]?[0-9]){8,}', '[broj]', 'g')
$$;

revoke execute on function scrub_error_text(text) from public, anon, authenticated;

revoke execute on function log_error(text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function log_error(text, text, text, text, text, text, uuid)
  to service_role;

-- Ono što je već nakupljeno starije od nove retencije nikome ne treba.
delete from error_events where occurred_at < now() - interval '7 days';
