-- Vraća da li ulogovani korisnik pripada datom tenantu.
--
-- SECURITY DEFINER je ovde namerno: politike svih ostalih tabela pitaju ovu
-- funkciju, pa bi bez toga svaka provera vukla i politiku nad `memberships`.
-- Funkcija ne prima ništa osim tenant_id i ne vraća nijedan podatak, samo
-- tačno/netačno, pa proširenje prava ne otvara ništa.
create function is_tenant_member(target_tenant_id uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships
    where memberships.tenant_id = target_tenant_id
      and memberships.user_id = auth.uid()
  )
$$;

alter table tenants enable row level security;
alter table memberships enable row level security;
alter table staff enable row level security;
alter table services enable row level security;
alter table staff_services enable row level security;
alter table working_hours enable row level security;
alter table time_off enable row level security;
alter table clients enable row level security;
alter table appointments enable row level security;
alter table appointment_events enable row level security;

-- tenants i memberships se u Fazi 0 samo čitaju; menja ih seed skripta,
-- koja ide preko service_role i zaobilazi RLS.

create policy tenants_select on tenants
  for select to authenticated
  using (is_tenant_member(id));

create policy memberships_select on memberships
  for select to authenticated
  using (is_tenant_member(tenant_id));

create policy staff_select on staff
  for select to authenticated using (is_tenant_member(tenant_id));
create policy staff_insert on staff
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy staff_update on staff
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy staff_delete on staff
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy services_select on services
  for select to authenticated using (is_tenant_member(tenant_id));
create policy services_insert on services
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy services_update on services
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy services_delete on services
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy staff_services_select on staff_services
  for select to authenticated using (is_tenant_member(tenant_id));
create policy staff_services_insert on staff_services
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy staff_services_delete on staff_services
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy working_hours_select on working_hours
  for select to authenticated using (is_tenant_member(tenant_id));
create policy working_hours_insert on working_hours
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy working_hours_update on working_hours
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy working_hours_delete on working_hours
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy time_off_select on time_off
  for select to authenticated using (is_tenant_member(tenant_id));
create policy time_off_insert on time_off
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy time_off_update on time_off
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy time_off_delete on time_off
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy clients_select on clients
  for select to authenticated using (is_tenant_member(tenant_id));
create policy clients_insert on clients
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy clients_update on clients
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy clients_delete on clients
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy appointments_select on appointments
  for select to authenticated using (is_tenant_member(tenant_id));
create policy appointments_insert on appointments
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy appointments_update on appointments
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy appointments_delete on appointments
  for delete to authenticated using (is_tenant_member(tenant_id));

-- Audit log se dopisuje i čita, nikad ne menja i ne briše. Odsustvo update i
-- delete politike je namerno i jedini je razlog zašto dokaz „ja to nisam
-- otkazala" nešto vredi.
create policy appointment_events_select on appointment_events
  for select to authenticated using (is_tenant_member(tenant_id));
create policy appointment_events_insert on appointment_events
  for insert to authenticated with check (is_tenant_member(tenant_id));
