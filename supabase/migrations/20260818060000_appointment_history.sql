-- Istorija jednog termina, za prikaz u kalendaru.
--
-- `appointment_events` se uredno puni od prve migracije, ali se nigde nije
-- prikazivao — vlasnica koja treba da dokaže „ja to nisam otkazala" nije imala
-- gde da pogleda, iako dokaz postoji.
--
-- Bez `security definer`: `appointment_events_select` već pušta samo članove
-- salona, pa RLS bira redove. Nečlan dobija praznu listu, isto kao za termin
-- koji ne postoji.
--
-- `device_id`, `actor_id` i `network_hash` se namerno ne vraćaju. To su tragovi
-- za sprečavanje zloupotrebe, ne podatak koji salon treba da vidi; mrežni heš
-- posebno, jer politika privatnosti obećava da se ne deli.

create function appointment_history(p_appointment_id uuid) returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'from_status', e.from_status,
        'to_status', e.to_status,
        'actor_type', e.actor_type,
        'created_at', e.created_at
      )
      order by e.created_at
    ),
    '[]'::jsonb
  )
  from appointment_events e
  where e.appointment_id = p_appointment_id;
$$;

revoke execute on function appointment_history(uuid) from public, anon;
grant execute on function appointment_history(uuid) to authenticated;
