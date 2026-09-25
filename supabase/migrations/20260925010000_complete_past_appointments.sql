-- Prošao dan: potvrđen termin je obavljen ------------------------------------
--
-- Vlasnica posle radnog dana ne otvara aplikaciju da bi štiklirala svaki
-- termin. Bez toga `completed` ne nastaje, a stalna klijentkinja ostaje
-- „nova" za limite zakazivanja (`booking_limit_reason` je prepoznaje samo po
-- obavljenom terminu). Izostanak je izuzetak i njega ona i dalje obeleži sama —
-- i posle ovoga, jer salon sme da promeni svaki status.
--
-- Termini pre 25. septembra 2026. se ne diraju: to je istorija koju je salon
-- vodio pre ovog pravila, i o njoj odluku ne donosi noćni posao.
--
-- Poziva je samo noćni posao sa servera, sa `service_role` ključem. `p_now`
-- postoji da bi test mogao da „pomeri sat"; posao ga ne šalje.

create function complete_past_appointments(p_now timestamptz default now())
returns integer
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
           < (p_now at time zone t.timezone)::date
     and (a.start_at at time zone t.timezone)::date >= date '2026-09-25';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function complete_past_appointments(timestamptz)
  from public, anon, authenticated;
grant execute on function complete_past_appointments(timestamptz)
  to service_role;
