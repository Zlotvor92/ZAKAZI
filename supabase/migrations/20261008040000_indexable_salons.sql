-- Mapa sajta pokazuje samo salone čija je javna strana stvarno otvorena ----------
--
-- `getIndexableSalons` je birao salone po dva uslova (uključeno zakazivanje,
-- nije pauziran), a stranica za zakazivanje (`public_booking_data`) traži još
-- dva: da pristup nije istekao i da postoji bar jedna usluga koju je moguće
-- zakazati. Salon sa isteklom pretplatom ili bez usluga je bio u mapi, a
-- pretraživač je na toj adresi nalazio poruku „zakazivanje nije dostupno".
--
-- Uslovi su ovde na jednom mestu, uz iste pomoćne funkcije koje koristi
-- stranica, pa mapa ne može da se razilazi od nje. Zovu je samo server
-- (`service_role`).

create function indexable_salons()
returns table (slug text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select t.slug, t.updated_at
  from tenants t
  where t.public_booking_enabled
    and t.suspended_at is null
    and not subscription_expired(t.paid_until, t.timezone)
    and exists (
      select 1
      from services s
      where s.tenant_id = t.id
        and s.active
        and exists (
          select 1 from staff_services ss
          where ss.staff_id = booking_staff_id(t.id) and ss.service_id = s.id
        )
    )
  order by t.slug
$$;

revoke execute on function indexable_salons() from public, anon, authenticated;
grant execute on function indexable_salons() to service_role;
