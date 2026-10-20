-- Keep the RPC signatures so pages opened before this release still work.
-- Phone matching is the only ownership condition, for both lookup and cancel.
-- The existing server-only RPC grants and salon boundaries remain in force.
create or replace function public.owned_appointment_ids(
  p_tenant_id uuid,
  p_phone_e164 text,
  p_secrets text[],
  p_device_id text
) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.appointments a
  join public.clients c on c.id = a.client_id and c.tenant_id = a.tenant_id
  where a.tenant_id = p_tenant_id
    and c.phone_e164 = p_phone_e164
    and p_phone_e164 ~ '^\+381[1-9][0-9]{7,8}$';
$$;

revoke execute on function public.owned_appointment_ids(uuid, text, text[], text)
  from public, anon, authenticated;
