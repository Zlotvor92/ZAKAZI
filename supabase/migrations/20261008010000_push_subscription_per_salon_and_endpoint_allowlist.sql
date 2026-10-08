-- Pretplata za obaveštenja: po salonu, i samo pravi push servisi -----------------
--
-- 1. `endpoint` je bio jedinstven u celoj tabeli, a `savePushSubscription` piše
--    upsertom preko njega. Isti telefon uključen za drugi salon istog korisnika
--    je zato prepisivao red prvog salona, i prvi salon je tiho ostajao bez
--    obaveštenja. Ključ je sada (salon, endpoint): jedan uređaj može da prati
--    više salona, a gašenje jednog ne dira drugi.
--
-- 2. Server šalje POST na `endpoint` koji je dao pregledač. Zod je proveravao
--    samo da je to adresa, a baza je prihvatala bilo koji https host, pa je
--    prijavljen korisnik mogao da nasloni serversko slanje na proizvoljno
--    odredište. Sada se dozvoljavaju samo hostovi push servisa pregledača; ista
--    lista je u `lib/domain/push-endpoint.ts`.
--
--    Ograničenje je `not valid`: važi za svaki novi i izmenjen red, a
--    postojeće redove ne dira. `notifyTenant` pri slanju preskače one koji ne
--    prolaze listu. Posle pregleda (upit ispod) može se potvrditi sa `validate`.
--
--      select id, tenant_id, endpoint from push_subscriptions
--       where endpoint !~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/';
--
--      alter table push_subscriptions
--        validate constraint push_subscriptions_endpoint_allowed;

alter table push_subscriptions
  drop constraint push_subscriptions_endpoint_key,
  add constraint push_subscriptions_tenant_id_endpoint_key
    unique (tenant_id, endpoint);

alter table push_subscriptions
  add constraint push_subscriptions_endpoint_allowed
  check (
    endpoint ~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/'
  ) not valid;
