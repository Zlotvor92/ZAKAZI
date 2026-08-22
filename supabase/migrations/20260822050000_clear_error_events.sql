-- Praznjenje evidencije grešaka ---------------------------------------------
--
-- Greška ostaje u spisku i pošto je popravljena. Crvena traka nad konzolom
-- onda javlja isti kvar danima, i vlasnik platforme se navikne da je
-- preskoči — a traka koja se preskače ne javlja ništa ni kad zatreba.
--
-- Zato dugme koje briše ono što je pročitano i rešeno. Redovi se ne mogu
-- vratiti, ali evidencija se ionako sama čisti posle mesec dana i nijedna
-- odluka ne visi o njoj: ovo je telemetrija, ne knjigovodstvo. Za trag o
-- tome ko je šta menjao postoji `appointment_events`, koji ovo ne dira.

/**
 * Briše evidenciju grešaka i vraća koliko je redova otišlo.
 *
 * Pravo se proverava ovde, a ne u aplikaciji: `is_platform_owner()` je isti
 * uslov pod kojim se spisak i čita, pa se brisanje ne može ni zaobići ni
 * zaboraviti. Ko to nije, dobija nulu i ne sazna da li je išta postojalo.
 */
create function clear_error_events() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if not is_platform_owner() then
    return 0;
  end if;

  delete from error_events;
  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

revoke execute on function clear_error_events() from public, anon;
grant execute on function clear_error_events() to authenticated;
