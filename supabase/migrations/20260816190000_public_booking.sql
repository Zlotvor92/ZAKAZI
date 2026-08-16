-- Javna stranica za zakazivanje.
--
-- Neulogovan posetilac ne dobija pristup nijednoj tabeli. Dobija dve
-- funkcije: jednu koja mu izruči sirovinu za računanje slobodnih termina, i
-- jednu koja upiše rezervaciju. Sve što izlazi napolje je ovde nabrojano —
-- tuđe ime, telefon i usluga ne izlaze nikad, samo goli zauzeti intervali.
--
-- Obe rade kao vlasnik tabela, pa je obaveza svakog upita unutra da sam
-- ograniči domet na razrešeni salon. RLS ih ne štiti.

-- Izvođač na koga se javno zakazivanje odnosi. U ovoj fazi salon ima jednog,
-- pa se bira najstariji aktivan. Obe funkcije pitaju isto ovo mesto, da ne bi
-- ponudile termine jednog izvođača a zakazale kod drugog.
create function booking_staff_id(p_tenant_id uuid) returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from staff
  where tenant_id = p_tenant_id and active
  order by created_at, id
  limit 1
$$;

-- Supabase preko `alter default privileges` daje pravo izvršavanja direktno
-- rolama `anon` i `authenticated`, a ne roli `public`. Zato skidanje sa
-- `public` ne skida ništa i svaka nova funkcija je podrazumevano otvorena
-- svetu dok se to izričito ne povuče.
revoke execute on function booking_staff_id(uuid)
  from public, anon, authenticated;

-- Sirovina za računanje slobodnih termina.
--
-- Raspon dana određuje baza, ne pozivalac — inače bi neulogovan posetilac
-- zatražio deset godina unazad i pokupio ceo kalendar salona. Iz istog
-- razloga se vraća i `now`: motor u aplikaciji računa najraniji termin od
-- istog časovnika od kog su birani zauzeti intervali.
create function public_booking_data(p_slug text) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant tenants;
  v_staff_id uuid;
  v_now timestamptz := now();
  v_from_date date;
  v_to_date date;
  v_window tstzrange;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or not v_tenant.public_booking_enabled then
    return null;
  end if;

  v_staff_id := booking_staff_id(v_tenant.id);

  v_from_date := (v_now at time zone v_tenant.timezone)::date;
  v_to_date := v_from_date + v_tenant.booking_horizon_days;
  v_window := tstzrange(
    v_from_date::timestamp at time zone v_tenant.timezone,
    (v_to_date + 1)::timestamp at time zone v_tenant.timezone,
    '[)'
  );

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'name', v_tenant.name,
      'slug', v_tenant.slug,
      'timezone', v_tenant.timezone,
      'min_lead_minutes', v_tenant.min_lead_minutes
    ),
    'now', v_now,
    'from_date', v_from_date,
    'to_date', v_to_date,
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'duration_min', s.duration_min,
          'buffer_after_min', s.buffer_after_min,
          'price_rsd', s.price_rsd
        )
        order by s.name
      )
      from services s
      where s.tenant_id = v_tenant.id
        and s.active
        and exists (
          select 1 from staff_services ss
          where ss.staff_id = v_staff_id and ss.service_id = s.id
        )
    ), '[]'::jsonb),
    -- Minuti od ponoći, a ne ispisano vreme: `24:00` je dozvoljeno radno
    -- vreme i mora da preživi put do aplikacije kao kraj dana.
    'working_hours', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', wh.weekday,
          'start_minute', (extract(epoch from wh.start_time) / 60)::int,
          'end_minute', (extract(epoch from wh.end_time) / 60)::int
        )
        order by wh.weekday, wh.start_time
      )
      from working_hours wh
      where wh.staff_id = v_staff_id
    ), '[]'::jsonb),
    -- Jedino što se zna o tuđem terminu je da ga ima i koliko traje.
    'busy', coalesce((
      select jsonb_agg(
        jsonb_build_object('start_at', taken.start_at, 'end_at', taken.end_at)
        order by taken.start_at
      )
      from (
        select lower(a.blocked_range) as start_at, upper(a.blocked_range) as end_at
        from appointments a
        where a.staff_id = v_staff_id
          and a.status in ('pending', 'confirmed')
          and a.blocked_range && v_window
        union all
        select t.start_at, t.end_at
        from time_off t
        where t.staff_id = v_staff_id
          and tstzrange(t.start_at, t.end_at, '[)') && v_window
      ) taken
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public_booking_data(text) from public;
grant execute on function public_booking_data(text) to anon, authenticated;

-- Upis rezervacije sa javne stranice.
--
-- Sve što je motor u aplikaciji već proverio proverava se ovde ponovo, jer
-- poziv ne mora da dođe sa naše stranice. Aplikacija proverava da bi poruka
-- bila lepša; ovo je jedino mesto koje stvarno odlučuje.
--
-- Razlog odbijanja se vraća kao podatak, ne kao greška, da bi stranica mogla
-- da ga prevede u rečenicu. Jedini izuzetak je trka za isti termin: nju hvata
-- ograničenje u bazi i vraća se kao `slot_taken`.
create function public_book(
  p_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_client_name text,
  p_phone_e164 text,
  p_device_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Ista mreža koju koristi `SLOT_STEP_MIN` u lib/domain/availability.ts.
  c_slot_step_min constant integer := 15;
  -- Koliko budućih termina jedan broj telefona sme da drži u istom salonu.
  c_max_active_per_phone constant integer := 2;

  v_tenant tenants;
  v_service services;
  v_staff_id uuid;
  v_now timestamptz := now();
  v_today date;
  v_local_date date;
  v_opens_at timestamptz;
  v_name text;
  v_client_id uuid;
  v_appointment_id uuid;
  v_active_count integer;
  v_blocked tstzrange;
begin
  select * into v_tenant from tenants where slug = p_slug;

  if not found or not v_tenant.public_booking_enabled then
    return jsonb_build_object('ok', false, 'reason', 'booking_closed');
  end if;

  v_name := btrim(coalesce(p_client_name, ''));
  if v_name = '' or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  if coalesce(p_phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  v_staff_id := booking_staff_id(v_tenant.id);
  if v_staff_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;

  select * into v_service
  from services
  where id = p_service_id
    and tenant_id = v_tenant.id
    and active
    and exists (
      select 1 from staff_services ss
      where ss.staff_id = v_staff_id and ss.service_id = services.id
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_service');
  end if;

  v_today := (v_now at time zone v_tenant.timezone)::date;
  v_local_date := (p_start_at at time zone v_tenant.timezone)::date;

  if v_local_date < v_today
     or v_local_date > v_today + v_tenant.booking_horizon_days then
    return jsonb_build_object('ok', false, 'reason', 'outside_window');
  end if;

  if p_start_at < v_now + make_interval(mins => v_tenant.min_lead_minutes) then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;

  -- Usluga mora cela da stane u jednu smenu. Bafer sme da je prekorači, isto
  -- kao u motoru — zato se ovde poredi samo trajanje usluge.
  select (v_local_date + wh.start_time) at time zone v_tenant.timezone
    into v_opens_at
  from working_hours wh
  where wh.staff_id = v_staff_id
    and wh.weekday = extract(isodow from v_local_date)
    and p_start_at >= (v_local_date + wh.start_time) at time zone v_tenant.timezone
    and p_start_at + make_interval(mins => v_service.duration_min)
        <= (v_local_date + wh.end_time) at time zone v_tenant.timezone
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'outside_working_hours');
  end if;

  if extract(epoch from (p_start_at - v_opens_at))::bigint
       % (c_slot_step_min * 60) <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'off_grid');
  end if;

  v_blocked := tstzrange(
    p_start_at,
    p_start_at + make_interval(
      mins => v_service.duration_min + v_service.buffer_after_min
    ),
    '[)'
  );

  -- Odsustvo je u drugoj tabeli, pa ga ograničenje nad `appointments` ne vidi.
  if exists (
    select 1 from time_off t
    where t.staff_id = v_staff_id
      and tstzrange(t.start_at, t.end_at, '[)') && v_blocked
  ) then
    return jsonb_build_object('ok', false, 'reason', 'time_off');
  end if;

  select count(*) into v_active_count
  from appointments a
  join clients c on c.id = a.client_id
  where a.tenant_id = v_tenant.id
    and c.phone_e164 = p_phone_e164
    and a.status in ('pending', 'confirmed')
    and a.start_at >= v_now;

  if v_active_count >= c_max_active_per_phone then
    return jsonb_build_object('ok', false, 'reason', 'too_many_bookings');
  end if;

  perform set_config('app.actor_type', 'client', true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);

  begin
    -- Ime se ne prepisuje preko postojećeg: salon je možda već ispravio kako
    -- se klijentkinja zove i to ne sme da nestane pri sledećem zakazivanju.
    insert into clients (tenant_id, name, phone_e164)
    values (v_tenant.id, v_name, p_phone_e164)
    on conflict (tenant_id, phone_e164) do nothing;

    select id into v_client_id
    from clients
    where tenant_id = v_tenant.id and phone_e164 = p_phone_e164;

    insert into appointments (
      tenant_id, staff_id, service_id, client_id, start_at,
      duration_min, buffer_after_min, price_rsd, status, source, confirmed_at
    ) values (
      v_tenant.id, v_staff_id, v_service.id, v_client_id, p_start_at,
      v_service.duration_min, v_service.buffer_after_min, v_service.price_rsd,
      'confirmed', 'public', v_now
    )
    returning id into v_appointment_id;
  exception when exclusion_violation then
    -- Dvoje je kliknulo isti termin u istoj sekundi. Drugi dobija rečenicu,
    -- ne petsto.
    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end;

  return jsonb_build_object(
    'ok', true,
    'appointment', jsonb_build_object(
      'id', v_appointment_id,
      'start_at', p_start_at,
      'end_at', p_start_at + make_interval(mins => v_service.duration_min),
      'service_name', v_service.name,
      'price_rsd', v_service.price_rsd
    )
  );
end;
$$;

revoke execute on function public_book(text, uuid, timestamptz, text, text, text)
  from public;
grant execute on function public_book(text, uuid, timestamptz, text, text, text)
  to anon, authenticated;

-- Iz istog razloga i triger funkcija: Postgres doduše odbija da je pozove
-- izvan trigera, ali pravo koje joj niko nije namerno dao ne treba da stoji.
revoke execute on function log_appointment_status_change()
  from public, anon, authenticated;
