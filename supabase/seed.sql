-- Jedan salon sa svime što je potrebno da se prijaviš i vidiš kalendar.
-- `supabase db reset` ovo pokreće sam. Može i ručno, iz Supabase SQL editora.
-- Sme da se pokreće više puta — salon se svaki put pravi iznova.

do $$
declare
  v_owner_email text := 'vlasnik@primer.rs';
  v_owner_id uuid;
  v_tenant_id uuid;
  v_staff_id uuid;
begin
  select id into v_owner_id from auth.users where email = v_owner_email;

  if v_owner_id is null then
    v_owner_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_owner_id,
      'authenticated', 'authenticated', v_owner_email, now(),
      now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', ''
    );
  end if;

  delete from tenants where slug = 'studio-milica';

  insert into tenants (slug, name, timezone, plan)
  values ('studio-milica', 'Studio Milica', 'Europe/Belgrade', 'trial')
  returning id into v_tenant_id;

  insert into memberships (user_id, tenant_id, role)
  values (v_owner_id, v_tenant_id, 'owner');

  insert into staff (tenant_id, user_id, name)
  values (v_tenant_id, v_owner_id, 'Milica')
  returning id into v_staff_id;

  -- Usluga više ne nosi trajanje: koliko termin traje kaže radno vreme.
  insert into services (tenant_id, name, price_rsd)
  values
    (v_tenant_id, 'Gel nokti', 3000),
    (v_tenant_id, 'Korekcija gela', 2400),
    (v_tenant_id, 'Manikir', 1500);

  insert into staff_services (tenant_id, staff_id, service_id)
  select v_tenant_id, v_staff_id, services.id
  from services
  where services.tenant_id = v_tenant_id;

  -- Podeljena smena radnim danima, subota u jednom komadu. Termin traje sat i
  -- po, pa pre podne staju dva i posle podne dva.
  -- ISO dani: 1 = ponedeljak.
  insert into working_hours
    (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
  select v_tenant_id, v_staff_id, weekday, '09:00'::time, '12:00'::time, 90
  from generate_series(1, 5) as weekday
  union all
  select v_tenant_id, v_staff_id, weekday, '17:00'::time, '20:00'::time, 90
  from generate_series(1, 5) as weekday
  union all
  select v_tenant_id, v_staff_id, 6, '09:00'::time, '14:00'::time, 90;

  raise notice 'Salon "Studio Milica" napravljen. Vlasnik: %', v_owner_email;
end
$$;
