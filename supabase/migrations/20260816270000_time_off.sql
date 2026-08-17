-- Odsustvo koje vlasnica unosi sama.
--
-- Izvođač se bira ovde, istim redosledom kao svuda, da ekran ne bi morao da
-- zna ko je izvođač ni da mu se veruje da ga je poslao tačno.
--
-- Bez `security definer`: i izbor izvođača i upis prolaze kroz RLS.
create function add_time_off(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_tenant_id uuid;
  v_id uuid;
begin
  if p_start_at >= p_end_at then
    return jsonb_build_object('ok', false, 'reason', 'end_before_start');
  end if;

  select id, tenant_id into v_staff_id, v_tenant_id
  from staff
  where active
  order by created_at, id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  insert into time_off (tenant_id, staff_id, start_at, end_at, reason)
  values (
    v_tenant_id, v_staff_id, p_start_at, p_end_at,
    nullif(btrim(coalesce(p_reason, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function add_time_off(timestamptz, timestamptz, text)
  from public, anon;
grant execute on function add_time_off(timestamptz, timestamptz, text)
  to authenticated;
