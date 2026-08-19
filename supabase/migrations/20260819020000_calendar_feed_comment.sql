-- Kome funkcija služi, u samoj bazi -----------------------------------------
--
-- `calendar_feed` je jedina funkcija koju neprijavljen sme da pozove a koja
-- vraća imena i brojeve klijentkinja. Ko je zatekne u spisku bez konteksta
-- pomisliće da je rupa. Ovo mu odgovara na licu mesta.

comment on function calendar_feed(uuid) is
  'Termini salona za kalendar aplikaciju vlasnice. Bez prijave namerno: '
  'kalendar aplikacija ne ume da se prijavi, pa je token iz tenants.calendar_token '
  'jedini dokaz. Netačan token vraća prazan skup.';
