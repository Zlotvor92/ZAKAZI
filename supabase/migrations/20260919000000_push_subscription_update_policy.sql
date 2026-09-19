-- Ponovno uključivanje obaveštenja na istom telefonu -------------------------
--
-- `savePushSubscription` piše upsertom, jer pregledač posle brisanja podataka
-- ume da vrati isti `endpoint`, a on je jedinstven u celoj tabeli. PostgREST
-- to šalje kao `insert ... on conflict do update`, a tabela je imala politike
-- samo za `select`, `insert` i `delete`. Prvo uključivanje je zato prolazilo,
-- a svako sledeće na istom uređaju padalo sa:
--
--   new row violates row-level security policy (USING expression)
--
-- Vlasnica je videla samo „Uključivanje nije uspelo. Pokušaj ponovo." i
-- ponavljanje nije moglo da pomogne.
--
-- `using` gleda red koji se menja, `with check` red koji nastaje: tuđa
-- pretplata ostaje nedodirljiva i kad se pogodi njen `endpoint`.

create policy push_subscriptions_update on push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and is_tenant_member(tenant_id));
