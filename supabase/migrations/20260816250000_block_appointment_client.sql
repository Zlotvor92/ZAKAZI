-- Blokiranje broja sa samog termina.
--
-- Broj se ne prima kao argument nego se čita iz termina: tako vlasnica ne
-- može ni greškom ni namerno da blokira broj koji nije njen klijent, a ekran
-- ne mora da mu veruje.
--
-- Blokada ne dira sam termin. Odluka da neko više ne zakazuje sam i odluka da
-- se današnji termin otkaže su dve različite odluke.
--
-- Bez `security definer`: i termin i klijent i upis u listu prolaze kroz RLS.
create function block_appointment_client(
  p_appointment_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_phone text;
begin
  select a.tenant_id, c.phone_e164
    into v_tenant_id, v_phone
  from appointments a
  join clients c on c.id = a.client_id
  where a.id = p_appointment_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into blocklist (tenant_id, phone_e164, reason, created_by)
  values (v_tenant_id, v_phone, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  on conflict (tenant_id, phone_e164) do nothing;

  return jsonb_build_object('ok', true, 'phone_e164', v_phone);
end;
$$;

revoke execute on function block_appointment_client(uuid, text)
  from public, anon;
grant execute on function block_appointment_client(uuid, text) to authenticated;
