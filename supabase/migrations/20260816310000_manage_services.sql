-- Usluge unosi salon, ne onaj ko održava aplikaciju.
--
-- Dok god trajanje i cenu upisuje neko drugi, svaki novi salon mora nekoga da
-- pita. Ovo je poslednje mesto na kom je salon zavisio od nas.
--
-- Bez `security definer`: i salon i izvođač i usluga prolaze kroz RLS, pa se
-- ništa ne može upisati u tuđi salon.

create function upsert_service(
  p_id uuid,
  p_name text,
  p_duration_min integer,
  p_price_rsd integer
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_staff_id uuid;
  v_name text;
  v_id uuid;
begin
  v_name := btrim(coalesce(p_name, ''));

  if v_name = '' or length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if p_duration_min is null or p_duration_min <= 0 or p_duration_min > 1440 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_duration');
  end if;

  if p_price_rsd is null or p_price_rsd < 0 or p_price_rsd > 10000000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_price');
  end if;

  if p_id is not null then
    update services
       set name = v_name,
           duration_min = p_duration_min,
           price_rsd = p_price_rsd
     where id = p_id
    returning id into v_id;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  select id into v_tenant_id from tenants order by created_at limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into services (tenant_id, name, duration_min, price_rsd)
  values (v_tenant_id, v_name, p_duration_min, p_price_rsd)
  returning id into v_id;

  -- Bez veze sa izvođačem usluga ne bi izašla na javnu stranicu, a salon ne
  -- bi imao gde da vidi zašto. Veza se pravi ovde, ne prepušta se ekranu.
  select id into v_staff_id
  from staff
  where tenant_id = v_tenant_id and active
  order by created_at, id
  limit 1;

  if v_staff_id is not null then
    insert into staff_services (tenant_id, staff_id, service_id)
    values (v_tenant_id, v_staff_id, v_id)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function upsert_service(uuid, text, integer, integer)
  from public, anon;
grant execute on function upsert_service(uuid, text, integer, integer)
  to authenticated;

/*
 * Uklanjanje usluge.
 *
 * Usluga na koju pokazuje neki termin se ne briše nego gasi: brisanjem bi
 * nestalo i šta je tačno rađeno prošlog meseca. Usluga koju niko nije koristio
 * nestaje sasvim, da pogrešno otkucana ne bi zauvek stajala u spisku.
 */
create function remove_service(p_id uuid) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_used boolean;
begin
  if not exists (select 1 from services where id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select exists (select 1 from appointments where service_id = p_id) into v_used;

  if v_used then
    update services set active = false where id = p_id;
    return jsonb_build_object('ok', true, 'outcome', 'deactivated');
  end if;

  delete from services where id = p_id;
  return jsonb_build_object('ok', true, 'outcome', 'deleted');
end;
$$;

revoke execute on function remove_service(uuid) from public, anon;
grant execute on function remove_service(uuid) to authenticated;
