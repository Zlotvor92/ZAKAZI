-- `delete` bez `where` produkcija odbija ---------------------------------------
--
-- Dugme za pražnjenje evidencije nije radilo, a nije se ni žalilo. Poziv je
-- stizao do baze i vraćao se sa `21000: DELETE requires a WHERE clause`.
--
-- Supabase u svaku sesiju učitava `supautils` (`session_preload_libraries`),
-- koji neprivilegovanim rolama zabranjuje `delete` i `update` bez `where`.
-- Privilegovane role su izuzete, pa migracije — koje se izvršavaju kao
-- `postgres` — prolaze i sa golim `update tenants set ...`. Ali funkcija koju
-- zove prijavljeni korisnik radi u njegovoj sesiji, i zabrana važi za nju čak
-- i kad je `security definer`: ne bira je vlasnik funkcije nego sesija.
--
-- Golim Postgresom se ovo ne može uhvatiti. Testovi baze i lokalno i u CI
-- rade nad čistim serverom bez `supautils`, gde isti upit uredno prođe — pa
-- je 306 testova bilo zeleno dok je dugme u produkciji ćutalo.
--
-- `where true` briše isto što i `delete` bez uslova, ali prolazi proveru. Ne
-- uklanjati ga: bez njega funkcija ponovo radi svuda osim tamo gde treba.

create or replace function clear_error_events() returns integer
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

  delete from error_events where true;
  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;
