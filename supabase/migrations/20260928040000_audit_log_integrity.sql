-- Istoriju termina ne piše ni ne briše niko osim baze ---------------------------
--
-- Audit log je dokaz u sporu „ja to nisam otkazala", a stranka sa razlogom da
-- ga menja je salon. Dve rupe:
--
--  1. Politika `appointment_events_insert` je svakom članu salona dozvoljavala
--     da upiše red sa proizvoljnim `actor_type` i `to_status`, na primer
--     „klijentkinja je otkazala". Redove upisuje triger
--     `log_appointment_status_change`, koji je `security definer` i politiku ne
--     traži, pa politika nije potrebna.
--  2. `appointments_delete` je dozvoljavao brisanje termina, a strani ključ iz
--     `appointment_events` je bio `on delete cascade`, pa je s terminom nestajao
--     i dokaz. Termin se otkazuje statusom; brisanja u aplikaciji nema.
--
-- Brisanje celog salona (`delete_tenant`) i dalje radi: briše i termine i
-- istoriju istovremeno, preko `tenants`.

drop policy appointment_events_insert on appointment_events;
revoke insert, update, delete, truncate on appointment_events from authenticated;

drop policy appointments_delete on appointments;
revoke delete, truncate on appointments from authenticated;

alter table appointment_events
  drop constraint appointment_events_tenant_id_appointment_id_fkey,
  add constraint appointment_events_tenant_id_appointment_id_fkey
    foreign key (tenant_id, appointment_id)
    references appointments (tenant_id, id)
    on delete restrict;
