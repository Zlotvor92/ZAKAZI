-- Zakazivanje, otkazivanje i pretraga po broju zove samo server -----------------
--
-- Ove tri funkcije primaju `p_network_hash` i `p_device_id`, a na njima stoje
-- ograničenja brzine. Dok ih je mogla da pozove `anon` rola, svako ko ima javni
-- anon ključ iz JS-a slao je nov hash u svakom pozivu i limit po mreži nije
-- važio. Sada ih zove isključivo server (service_role), koji hash računa sam
-- iz zaglavlja zahteva, pa pozivalac ne može da ga izabere.
--
-- `public_booking_data` i `public_salon_summary` ostaju javne: ne primaju ništa
-- što utiče na limite i ne upisuju ništa.

revoke execute on function
  public_book(text, uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated;

revoke execute on function
  public_cancel_appointment(text, text, uuid, text, text)
  from public, anon, authenticated;

revoke execute on function
  public_appointments_for_phone(text, text, text)
  from public, anon, authenticated;

grant execute on function
  public_book(text, uuid, timestamptz, text, text, text, text)
  to service_role;

grant execute on function
  public_cancel_appointment(text, text, uuid, text, text)
  to service_role;

grant execute on function
  public_appointments_for_phone(text, text, text)
  to service_role;
