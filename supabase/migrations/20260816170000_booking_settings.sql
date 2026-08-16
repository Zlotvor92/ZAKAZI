-- Podešavanja koja određuju šta javna stranica sme da ponudi.

alter table tenants
  -- Koliko dana unapred klijent sme da bira. Uključuje današnji dan.
  add column booking_horizon_days smallint not null default 14,
  -- Koliko unapred termin mora biti zakazan. Bez ovoga neko rezerviše za
  -- deset minuta dok je izvođač na nogama i ne gleda telefon.
  add column min_lead_minutes integer not null default 120,
  -- Prekidač za salon koji još nije spreman da pusti link u svet.
  add column public_booking_enabled boolean not null default true;

alter table tenants
  add constraint tenants_booking_horizon_range
    check (booking_horizon_days between 1 and 90),
  -- Gornja granica je nedelja dana: sve preko toga je greška u unosu, jer bi
  -- zajedno sa horizontom ostavilo salon bez ijednog slobodnog termina.
  add constraint tenants_min_lead_range
    check (min_lead_minutes between 0 and 10080);
