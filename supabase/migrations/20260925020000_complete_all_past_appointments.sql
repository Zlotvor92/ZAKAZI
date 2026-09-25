-- Obavljeno važi i za termine od pre pravila ---------------------------------
--
-- Migracija 20260925010000 je termine pre 25. septembra 2026. ostavila
-- nedirnute, jer nije bilo jasno da li su obavljeni. Salon je potvrdio da jesu:
-- sve do danas je odrađeno. Granica zato otpada, i posao se ponaša isto za
-- svaki dan.

create or replace function complete_past_appointments(
  p_now timestamptz default now()
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Istorija mora da kaže da je ovo uradio sistem, ne vlasnica.
  perform set_config('app.actor_type', 'system', true);

  update appointments a
     set status = 'completed'
    from tenants t
   where t.id = a.tenant_id
     and a.status = 'confirmed'
     and (a.start_at at time zone t.timezone)::date
           < (p_now at time zone t.timezone)::date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
