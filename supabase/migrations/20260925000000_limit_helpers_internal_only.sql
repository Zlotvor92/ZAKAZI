-- Pomoćne funkcije za limite zove samo baza ----------------------------------
--
-- `booking_limit_reason` i `phone_lookup_limit_reason` zovu isključivo
-- `public_book`, `public_appointments_for_phone` i `public_cancel_appointment`,
-- koje rade kao vlasnik, pa pozivaocu pravo izvršavanja ne treba.
--
-- Migracija 20260818010000 je, praveći funkcije iznova, oduzela pravo samo
-- `public` i `anon`. Supabase novoj funkciji sam dodeli izvršavanje za
-- `authenticated`, pa je svaki prijavljen nalog mogao da pita za tuđi salon
-- „da li je ovaj broj blokiran" i „koliko termina ima ovaj broj". To je upravo
-- ono što salon o drugom salonu nikada ne sme da sazna.

revoke execute on function
  booking_limit_reason(uuid, text, timestamptz, text, text)
  from authenticated;

revoke execute on function phone_lookup_limit_reason(uuid, text)
  from authenticated;
