-- Niz cifara u rastućem ili opadajućem redu hvata se samo na mobilnim
-- brojevima.
--
-- Pretplatnički deo se računa tako što se odbiju dve cifre mreže, što važi za
-- mobilni broj (`64`, `62`). Kod fiksnog broja mreža je isto dve cifre (`11`,
-- `21`), ali je pretplatnički deo kraći i pravilniji, pa niz od sedam cifara
-- tamo nije znak da je broj izmišljen: `011 234 5678` je običan beogradski
-- broj — i stoji kao primer ispravnog broja u komentaru `lib/domain/phone.ts`
-- — a do sada je bio odbijan kao lažan.
--
-- Sve iste cifre ostaje znak izmišljenog broja na svakoj mreži i u svakoj
-- zemlji; menja se samo provera niza.
create or replace function phone_looks_fake(p_phone text) returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_national text;
  v_subscriber text;
  v_ascending boolean := true;
  v_descending boolean := true;
  v_step integer;
begin
  -- Sve iste cifre je izmišljen broj u svakoj zemlji.
  if v_digits ~ '^(\d)\1+$' then
    return true;
  end if;

  -- Van Srbije se ne zna gde prestaje mreža a počinje pretplatnik, pa se
  -- dalje ne nagađa.
  if left(v_digits, 3) <> '381' then
    return false;
  end if;

  v_national := substr(v_digits, 4);

  -- Nacionalni broj bez dve cifre mreže: iz `381645123480` ostaje `5123480`.
  v_subscriber := substr(v_digits, 6);

  if length(v_subscriber) >= 6 and v_subscriber ~ '^(\d)\1+$' then
    return true;
  end if;

  -- Sedam, ne šest: u kraćem obliku broja (`064 123 456`) pretplatnički deo
  -- ima tačno šest cifara, pa bi niz od šest odbio i stvaran broj.
  if length(v_subscriber) < 7 then
    return false;
  end if;

  -- Mobilni broj je `06x`, dakle nacionalni počinje šesticom. Na fiksnom niz
  -- cifara nije signal.
  if left(v_national, 1) <> '6' then
    return false;
  end if;

  for i in 2..length(v_subscriber) loop
    v_step := ascii(substr(v_subscriber, i, 1))
            - ascii(substr(v_subscriber, i - 1, 1));
    if v_step <> 1 then
      v_ascending := false;
    end if;
    if v_step <> -1 then
      v_descending := false;
    end if;
  end loop;

  return v_ascending or v_descending;
end;
$$;
