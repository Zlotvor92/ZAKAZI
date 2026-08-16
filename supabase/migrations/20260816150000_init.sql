create extension if not exists btree_gist;

-- Postgres nema ugrađen range tip nad `time`, a radno vreme je zidno vreme
-- koje se ponavlja, ne trenutak u vremenu. Bez ovoga ne možemo baziti
-- ograničenje protiv preklapanja smena istog dana.
create type timerange as range (subtype = time);

create type membership_role as enum ('owner', 'staff');

create type appointment_status as enum (
  'pending',
  'confirmed',
  'completed',
  'no_show',
  'cancelled_by_client',
  'cancelled_by_salon'
);

create type appointment_source as enum ('salon', 'public');

create type actor_type as enum ('user', 'client', 'system');

-- `timestamptz + interval` je u Postgresu STABLE, jer interval sme da nosi
-- dane i mesece čije trajanje zavisi od tajmzone. Nad samim minutima ta
-- zavisnost ne postoji — 90 minuta je 5400 sekundi i na dan prelaska na
-- letnje vreme — pa je ovaj omotač stvarno immutable i sme da stoji u
-- generisanoj koloni. Sme da prima isključivo minute.
create function add_minutes(at timestamptz, minutes integer) returns timestamptz
language sql
immutable
parallel safe
as $$
  select at + make_interval(mins => minutes)
$$;

create function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- tenants ---------------------------------------------------------------

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  timezone text not null default 'Europe/Belgrade',
  plan text not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  constraint tenants_name_not_blank check (length(btrim(name)) > 0)
);

create trigger tenants_set_updated_at
  before update on tenants
  for each row execute function set_updated_at();

-- memberships -----------------------------------------------------------

create table memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  role membership_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index memberships_tenant_id_idx on memberships (tenant_id);

-- staff -----------------------------------------------------------------

create table staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_name_not_blank check (length(btrim(name)) > 0),
  -- Meta ka kojoj gađaju složeni strani ključevi dece: dete ne može da
  -- pokaže na roditelja iz drugog tenanta ni greškom u kodu.
  constraint staff_tenant_id_key unique (tenant_id, id)
);

create index staff_tenant_id_idx on staff (tenant_id);

create trigger staff_set_updated_at
  before update on staff
  for each row execute function set_updated_at();

-- services --------------------------------------------------------------

create table services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null,
  duration_min integer not null,
  buffer_after_min integer not null default 0,
  price_rsd integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_name_not_blank check (length(btrim(name)) > 0),
  constraint services_duration_range check (duration_min > 0 and duration_min <= 1440),
  constraint services_buffer_range check (buffer_after_min >= 0 and buffer_after_min <= 1440),
  constraint services_price_not_negative check (price_rsd >= 0),
  constraint services_tenant_id_key unique (tenant_id, id)
);

create index services_tenant_id_idx on services (tenant_id);

create trigger services_set_updated_at
  before update on services
  for each row execute function set_updated_at();

-- staff_services --------------------------------------------------------

create table staff_services (
  tenant_id uuid not null references tenants (id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (staff_id, service_id),
  foreign key (tenant_id, staff_id) references staff (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references services (tenant_id, id) on delete cascade
);

create index staff_services_tenant_id_idx on staff_services (tenant_id);
create index staff_services_service_id_idx on staff_services (service_id);

-- working_hours ---------------------------------------------------------

create table working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  staff_id uuid not null,
  -- ISO 8601: 1 = ponedeljak ... 7 = nedelja. Poklapa se sa getISODay iz
  -- date-fns, pa nema prevođenja između baze i koda.
  weekday smallint not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint working_hours_weekday_range check (weekday between 1 and 7),
  constraint working_hours_start_before_end check (start_time < end_time),
  foreign key (tenant_id, staff_id) references staff (tenant_id, id) on delete cascade,
  -- Podeljena smena je više redova za isti dan; preklapanje tih redova je
  -- greška u podacima i baza je ta koja je odbija.
  constraint working_hours_no_overlap exclude using gist (
    staff_id with =,
    weekday with =,
    timerange(start_time, end_time, '[)') with &&
  )
);

create index working_hours_tenant_id_idx on working_hours (tenant_id);
create index working_hours_staff_id_weekday_idx on working_hours (staff_id, weekday);

-- time_off --------------------------------------------------------------

create table time_off (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  staff_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint time_off_start_before_end check (start_at < end_at),
  foreign key (tenant_id, staff_id) references staff (tenant_id, id) on delete cascade
);

create index time_off_tenant_id_idx on time_off (tenant_id);
create index time_off_staff_id_start_at_idx on time_off (staff_id, start_at);

-- clients ---------------------------------------------------------------

create table clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null,
  phone_e164 text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_name_not_blank check (length(btrim(name)) > 0),
  constraint clients_phone_e164_format check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint clients_tenant_id_phone_key unique (tenant_id, phone_e164),
  constraint clients_tenant_id_key unique (tenant_id, id)
);

create index clients_tenant_id_idx on clients (tenant_id);

create trigger clients_set_updated_at
  before update on clients
  for each row execute function set_updated_at();

-- appointments ----------------------------------------------------------

create table appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  client_id uuid not null,
  start_at timestamptz not null,
  -- Trajanje i bafer se prepisuju sa usluge u trenutku upisa. Kad salon
  -- kasnije promeni uslugu, prošli termini ne smeju da promene dužinu.
  duration_min integer not null,
  buffer_after_min integer not null default 0,
  price_rsd integer not null,
  status appointment_status not null default 'pending',
  source appointment_source not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Ono što klijent vidi i što piše u poruci.
  end_at timestamptz generated always as (
    add_minutes(start_at, duration_min)
  ) stored,
  -- Ono što stvarno zauzima izvođača: termin plus vreme za spremanje.
  blocked_range tstzrange generated always as (
    tstzrange(
      start_at,
      add_minutes(start_at, duration_min + buffer_after_min),
      '[)'
    )
  ) stored,
  constraint appointments_duration_range check (duration_min > 0 and duration_min <= 1440),
  constraint appointments_buffer_range check (buffer_after_min >= 0 and buffer_after_min <= 1440),
  constraint appointments_price_not_negative check (price_rsd >= 0),
  constraint appointments_tenant_id_key unique (tenant_id, id),
  foreign key (tenant_id, staff_id) references staff (tenant_id, id),
  foreign key (tenant_id, service_id) references services (tenant_id, id),
  foreign key (tenant_id, client_id) references clients (tenant_id, id),
  constraint appointments_no_overlap exclude using gist (
    staff_id with =,
    blocked_range with &&
  ) where (status in ('pending', 'confirmed'))
);

create index appointments_tenant_id_start_at_idx on appointments (tenant_id, start_at);
create index appointments_staff_id_start_at_idx on appointments (staff_id, start_at);
create index appointments_client_id_idx on appointments (client_id);
create index appointments_service_id_idx on appointments (service_id);

create trigger appointments_set_updated_at
  before update on appointments
  for each row execute function set_updated_at();

-- appointment_events ----------------------------------------------------

create table appointment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  appointment_id uuid not null,
  from_status appointment_status,
  to_status appointment_status not null,
  actor_type actor_type not null,
  actor_id uuid,
  device_id text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, appointment_id) references appointments (tenant_id, id) on delete cascade
);

create index appointment_events_appointment_id_created_at_idx
  on appointment_events (appointment_id, created_at);
create index appointment_events_tenant_id_idx on appointment_events (tenant_id);
