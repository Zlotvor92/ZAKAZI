-- Podešavanja koja vlasnica menja sama.

-- Radno vreme se upisuje kao celina, a ne red po red: između brisanja starog i
-- upisa novog kalendar ne sme da postoji u polovičnom stanju, a ograničenje
-- protiv preklapanja smena bi na polovičnom stanju i pucalo.
--
-- Bez `security definer`: i izbor izvođača i brisanje i upis prolaze kroz RLS.
create function set_working_hours(p_intervals jsonb) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_tenant_id uuid;
begin
  select id, tenant_id into v_staff_id, v_tenant_id
  from staff
  where active
  order by created_at, id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  delete from working_hours where staff_id = v_staff_id;

  -- Minuti u `time` idu preko niske, jer `make_interval(mins => 1440)::time`
  -- daje 00:00 i time ponoć na kraju dana pretvara u početak dana.
  insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time)
  select
    v_tenant_id,
    v_staff_id,
    (item->>'weekday')::smallint,
    (lpad(((item->>'start_minute')::int / 60)::text, 2, '0') || ':' ||
     lpad(((item->>'start_minute')::int % 60)::text, 2, '0'))::time,
    (lpad(((item->>'end_minute')::int / 60)::text, 2, '0') || ':' ||
     lpad(((item->>'end_minute')::int % 60)::text, 2, '0'))::time
  from jsonb_array_elements(coalesce(p_intervals, '[]'::jsonb)) as item;

  return jsonb_build_object('ok', true);
exception
  when exclusion_violation then
    return jsonb_build_object('ok', false, 'reason', 'overlapping');
  when check_violation or invalid_datetime_format or data_exception then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
end;
$$;

revoke execute on function set_working_hours(jsonb) from public, anon;
grant execute on function set_working_hours(jsonb) to authenticated;

-- Vlasnica sme da menja pravila zakazivanja, ali ne i slug, ime ili plan.
-- RLS ne ume da ograniči kolone, pa to radi privilegija nad kolonama; politika
-- ispod bira samo čiji je red.
revoke update on tenants from authenticated;
grant update (booking_horizon_days, min_lead_minutes, public_booking_enabled)
  on tenants to authenticated;

create policy tenants_update on tenants
  for update to authenticated
  using (is_tenant_member(id)) with check (is_tenant_member(id));
