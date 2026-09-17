-- Odsustvo upisano preko već zakazanog termina vraća koliko ih je zateklo.
--
-- Upis se ne odbija: vlasnica koja ide kod lekara ide kod lekara, a termin
-- koji se zbog toga mora pomeriti ostaje u kalendaru da bi imala koga da
-- pozove. Ali ne sme ni da prođe u tišini — bez broja u odgovoru ekran kaže
-- samo „Sačuvano", a klijentkinja u međuvremenu i dalje dolazi.
create or replace function add_time_off(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason text default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := resolve_tenant(p_tenant_id);
  v_staff_id uuid;
  v_id uuid;
  v_overlapping integer;
begin
  if p_start_at >= p_end_at then
    return jsonb_build_object('ok', false, 'reason', 'end_before_start');
  end if;

  select id into v_staff_id
  from staff
  where tenant_id = v_tenant_id and active
  order by created_at, id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  select count(*) into v_overlapping
  from appointments a
  where a.staff_id = v_staff_id
    and a.status in ('pending', 'confirmed')
    and a.blocked_range && tstzrange(p_start_at, p_end_at, '[)');

  insert into time_off (tenant_id, staff_id, start_at, end_at, reason)
  values (
    v_tenant_id, v_staff_id, p_start_at, p_end_at,
    nullif(btrim(coalesce(p_reason, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'overlapping', v_overlapping);
end;
$$;
