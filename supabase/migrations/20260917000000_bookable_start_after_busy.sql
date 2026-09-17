-- Baza prihvata tačno ono što javna strana ponudi.
--
-- Motor u `lib/domain/availability.ts` nudi, pored rasporeda salona, i kraj
-- svakog zauzetog komada — a zauzeto je i tuđi termin i odsustvo. Ova funkcija
-- je do sada priznavala samo kraj termina, i to samo termina koji je i počeo
-- unutar iste smene. Zbog toga je odsustvo od 09:00 do 10:30 u smeni sa
-- razmakom od 60 minuta davalo termin koji se ponudi, izabere i tek onda
-- odbije sa „Salon tada ne radi".
--
-- Sada je uslov isti kao u motoru: početak sme da bude na rasporedu, ili tačno
-- na kraju bilo kog zauzetog komada koji pada u ovu smenu. Da li je taj komad
-- termin ili odsustvo, i kad je počeo, ne menja ništa — bitno je da se posle
-- njega stvarno može početi.
create or replace function is_bookable_start(
  p_staff_id uuid,
  p_timezone text,
  p_start_at timestamptz
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from working_hours wh,
         lateral (
           select (p_start_at at time zone p_timezone)::date as local_date
         ) d,
         lateral (
           select (d.local_date + wh.start_time) at time zone p_timezone as opens,
                  (d.local_date + wh.end_time) at time zone p_timezone as closes
         ) b
    where wh.staff_id = p_staff_id
      and wh.weekday = extract(isodow from d.local_date)
      and p_start_at >= b.opens
      and p_start_at < b.closes
      and (
        -- Raspored salona.
        extract(epoch from (p_start_at - b.opens))::bigint
          % (wh.slot_minutes * 60) = 0
        -- Ili tačno kraj nečega što je do tada zauzimalo izvođača.
        or exists (
          select 1
          from appointments a
          where a.staff_id = p_staff_id
            and a.status in ('pending', 'confirmed')
            and upper(a.blocked_range) = p_start_at
        )
        or exists (
          select 1
          from time_off t
          where t.staff_id = p_staff_id
            and t.end_at = p_start_at
        )
      )
  )
$$;
