#!/usr/bin/env bash
# Provera posle vraćanja podataka u pun Supabase stek (restore-drill.yml).
#
#   PSQL="docker run --rm --network host -e PGPASSWORD=postgres postgres:17-alpine psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres" \
#   PSQL_IN="<isto, sa -i>" API_URL=... ANON_KEY=... SERVICE_ROLE_KEY=... \
#     .github/scripts/verify-drill.sh data.sql counts|api|snapshot
#
# Režimi:
#   counts    redovi u bazi naspram dump-a (odmah posle vraćanja)
#   api       prava, javna strana, prijava, RLS, dvostruko zakazivanje
#   snapshot  ispiše broj redova po tabeli, za poređenje pre i posle migracija
#
# Ništa ličnog se ne ispisuje: samo imena tabela, brojevi i HTTP kodovi. Mejlovi,
# telefoni i imena se čitaju u promenljive i nikad ne idu na izlaz.
#
# Proverava se ono što noćna proba (običan Postgres) ne može:
#  - da svaka tabela ima isto redova kao u dump-u;
#  - da prava (grant) iz migracija važe: `anon` ne čita `appointments`;
#  - da javna funkcija radi preko pravog PostgREST-a;
#  - da se vlasnik stvarno prijavi preko GoTrue-a nad vraćenim `auth.users`;
#  - da RLS sa tim pravim tokenom vidi tačno svoje salone i tačan broj termina;
#  - da baza i dalje odbija dvostruko zakazivanje.

set -euo pipefail

data="${1:?Potreban je fajl sa podacima}"
mode="${2:?Potreban je režim: counts, api ili snapshot}"
: "${PSQL:?}" "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"
PSQL_IN="${PSQL_IN:-$PSQL}"

# shellcheck disable=SC2086
q() { $PSQL -tAc "$1"; }

failed=0
fail() { echo "  ✗ $1"; failed=1; }
ok() { echo "  ✓ $1"; }

rows_in_file() {
  awk -v s="$1" -v t="$2" '
    $0 ~ "^COPY \""s"\"\\.\""t"\" " { u=1; next }
    u && $0 == "\\." { u=0 }
    u { n++ }
    END { print n+0 }
  ' "$data"
}

run_counts() {
echo "Redovi:"
tables=$(grep -o '^COPY "public"\."[^"]*"' "$data" | sed -E 's/.*\."([^"]*)"/\1/' | sort -u)
[ -n "$tables" ] || { echo "U fajlu nema nijedne tabele iz šeme public."; exit 1; }

for t in $tables; do
  expected=$(rows_in_file public "$t")
  actual=$(q "select count(*) from public.\"$t\"" 2>/dev/null || echo NEMA)
  [ "$expected" = "$actual" ] && ok "public.$t: $actual" || fail "public.$t: u fajlu $expected, u bazi $actual"
done
for t in users identities; do
  expected=$(rows_in_file auth "$t")
  actual=$(q "select count(*) from auth.\"$t\"" 2>/dev/null || echo NEMA)
  [ "$expected" = "$actual" ] && ok "auth.$t: $actual" || fail "auth.$t: u fajlu $expected, u bazi $actual"
done
}

run_api() {
echo "Prava (iz migracija, dump ih ne nosi):"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/rest/v1/appointments?select=id&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")
case "$code" in
  401|403) ok "anon ne čita appointments (HTTP $code)" ;;
  *) fail "anon čita appointments, HTTP $code" ;;
esac

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/public_book" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"p_slug":"x","p_service_id":"00000000-0000-0000-0000-000000000000","p_start_at":"2099-01-01T09:00:00Z","p_client_name":"x","p_phone_e164":"+381641234567"}')
case "$code" in
  401|403) ok "anon ne može da zove public_book (HTTP $code)" ;;
  *) fail "anon zove public_book, HTTP $code" ;;
esac

echo "Javna strana preko PostgREST-a:"
slug=$(q "select slug from tenants where public_booking_enabled and suspended_at is null and not subscription_expired(paid_until, timezone) order by created_at limit 1")
if [ -n "$slug" ]; then
  body=$(curl -s -X POST "$API_URL/rest/v1/rpc/public_booking_data" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg s "$slug" '{p_slug:$s}')")
  if echo "$body" | jq -e '.tenant.slug != null and (.services | type == "array")' > /dev/null 2>&1; then
    ok "public_booking_data vraća salon sa uslugama ($(echo "$body" | jq '.services | length') usluga)"
  else
    fail "public_booking_data ne vraća ispravan odgovor"
  fi
else
  echo "  ! nijedan salon nije otvoren za zakazivanje; provera preskočena"
fi

# Produkcija može da ima samo jedan salon, a izolacija između salona je upravo
# ono što RLS treba da dokaže. U steku koji se baca pravi se još jedan, sa
# svojim vlasnikom i terminom; pravi podaci se ne dodiruju.
owners=$(q "select count(distinct m.tenant_id) from memberships m join auth.users u on u.id = m.user_id where u.email is not null and u.email_confirmed_at is not null")
if [ "$owners" -lt 2 ] && [ "$(q "select count(*) from tenants where slug = 'drill-b'")" = "0" ]; then
  echo "Salona sa vlasnikom u kopiji: $owners. Pravim privremeni drugi salon u steku radi provere izolacije."
  created=$(curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
    -d '{"email":"drill-b@example.test","email_confirm":true}')
  second=$(echo "$created" | jq -r '.id // empty')
  if [ -z "$second" ]; then
    fail "drugi vlasnik nije napravljen ($(echo "$created" | jq -r '.error_code // .msg // "bez odgovora"'))"
  else
    # `\gset` umesto DO bloka: psql ne menja promenljive unutar `$$ ... $$`.
    $PSQL_IN -v ON_ERROR_STOP=1 -v uid="$second" -q <<'SQL'
insert into tenants (slug, name) values ('drill-b', 'Drill B') returning id as t_id \gset
insert into memberships (user_id, tenant_id, role) values (:'uid'::uuid, :'t_id'::uuid, 'owner');
insert into staff (tenant_id, name) values (:'t_id'::uuid, 'B') returning id as s_id \gset
insert into services (tenant_id, name, duration_min, price_rsd) values (:'t_id'::uuid, 'B usluga', 60, 1000) returning id as v_id \gset
insert into staff_services (tenant_id, staff_id, service_id) values (:'t_id'::uuid, :'s_id'::uuid, :'v_id'::uuid);
insert into clients (tenant_id, name, phone_e164) values (:'t_id'::uuid, 'B klijent', '+381641112233') returning id as c_id \gset
insert into appointments (tenant_id, staff_id, service_id, client_id, start_at, duration_min, price_rsd, status, source)
values (:'t_id'::uuid, :'s_id'::uuid, :'v_id'::uuid, :'c_id'::uuid, '2099-02-02 10:00+00', 60, 1000, 'confirmed', 'salon');
SQL
    ok "privremeni drugi salon napravljen"
  fi
fi

echo "Prijava i RLS sa pravim tokenom:"
login() {
  local email link hashed
  email=$(q "select email from auth.users where id = '$1'")
  link=$(curl -s -X POST "$API_URL/auth/v1/admin/generate_link" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg e "$email" '{type:"magiclink",email:$e}')")
  hashed=$(echo "$link" | jq -r '.hashed_token // empty')
  [ -n "$hashed" ] || { echo "generate_link: $(echo "$link" | jq -r '.error_code // .msg // "bez odgovora"')" >&2; return 1; }
  curl -s -X POST "$API_URL/auth/v1/verify" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg t "$hashed" '{type:"magiclink",token_hash:$t}')" | jq -r '.access_token // empty'
}

users=$(q "select user_id from (select distinct on (m.tenant_id) m.user_id, m.tenant_id from memberships m join auth.users u on u.id = m.user_id where u.email is not null and u.email_confirmed_at is not null order by m.tenant_id) t limit 2")
checked=0
for uid in $users; do
  token=$(login "$uid") || { fail "prijava vlasnika nije uspela"; continue; }
  [ -n "$token" ] || { fail "GoTrue nije vratio token posle prijave"; continue; }
  ok "prijava preko GoTrue-a uspela (vlasnik $((checked + 1)))"

  expected_tenants=$(q "select tenant_id from memberships where user_id = '$uid' order by 1")
  seen_tenants=$(curl -s "$API_URL/rest/v1/tenants?select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token" | jq -r '.[].id' | sort)
  expected_sorted=$(echo "$expected_tenants" | sort)
  if [ "$seen_tenants" = "$expected_sorted" ]; then
    ok "RLS: vidi tačno svoje salone ($(echo "$seen_tenants" | wc -l | tr -d ' '))"
  else
    fail "RLS: spisak salona se ne poklapa sa članstvom"
  fi

  expected_count=$(q "select count(*) from appointments where tenant_id in (select tenant_id from memberships where user_id = '$uid')")
  seen_count=$(curl -s -D - -o /dev/null "$API_URL/rest/v1/appointments?select=id&limit=1" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token" -H 'Prefer: count=exact' \
    | tr -d '\r' | awk -F/ 'tolower($0) ~ /^content-range/ { print $2 }')
  if [ "$seen_count" = "$expected_count" ]; then
    ok "RLS: vidi tačno svoje termine ($seen_count)"
  else
    fail "RLS: termina vidi $seen_count, a treba $expected_count"
  fi

  mine=$(curl -s -X POST "$API_URL/rest/v1/rpc/my_tenants" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d '{}' | jq 'length')
  [ "$mine" = "$(echo "$expected_tenants" | wc -l | tr -d ' ')" ] && ok "my_tenants vraća njene salone" || fail "my_tenants vraća $mine salona"

  checked=$((checked + 1))
done
[ "$checked" -ge 1 ] || fail "nijedan vlasnik sa potvrđenim mejlom nije nađen, prijava nije proverena"
[ "$checked" -ge 2 ] || echo "  ! samo jedan salon sa vlasnikom: izolacija između salona nije proverena"

echo "Dvostruko zakazivanje:"
# RAISE NOTICE ide na stderr, pa se spaja; `-i` je potreban da kontejner čita stdin.
result=$($PSQL_IN -tA 2>&1 <<'SQL' || true
begin;
do $$
declare
  t record;
  first_id uuid;
begin
  select a.tenant_id, a.staff_id, a.service_id, a.client_id into t
  from appointments a limit 1;
  if not found then
    raise notice 'NEMA_TERMINA';
    return;
  end if;
  insert into appointments (tenant_id, staff_id, service_id, client_id, start_at, duration_min, price_rsd, status, source)
  values (t.tenant_id, t.staff_id, t.service_id, t.client_id, '2099-01-05 09:00+00', 60, 1, 'confirmed', 'salon');
  begin
    insert into appointments (tenant_id, staff_id, service_id, client_id, start_at, duration_min, price_rsd, status, source)
    values (t.tenant_id, t.staff_id, t.service_id, t.client_id, '2099-01-05 09:30+00', 60, 1, 'confirmed', 'salon');
    raise notice 'PROSLO_DUPLO';
  exception when exclusion_violation then
    raise notice 'ODBIJENO';
  end;
end
$$;
rollback;
SQL
)
case "$result" in
  *ODBIJENO*) ok "baza odbija preklapanje termina istog izvođača" ;;
  *PROSLO_DUPLO*) fail "baza je PRIHVATILA preklapanje termina" ;;
  *NEMA_TERMINA*) echo "  ! nema nijednog termina; provera preskočena" ;;
  *) fail "provera dvostrukog zakazivanja nije mogla da se izvrši" ;;
esac
}

snapshot() {
  for t in $(grep -o '^COPY "public"\."[^"]*"' "$data" | sed -E 's/.*\."([^"]*)"/\1/' | sort -u); do
    echo "public.$t $(q "select count(*) from public.\"$t\"")"
  done
  for t in users identities; do
    echo "auth.$t $(q "select count(*) from auth.\"$t\"")"
  done
}

case "$mode" in
  counts) run_counts ;;
  api) run_api ;;
  snapshot) snapshot; exit 0 ;;
  *) echo "Nepoznat režim: $mode"; exit 2 ;;
esac

if [ "$failed" -ne 0 ]; then
  echo "Provera '$mode' NIJE prošla: vraćanje u Supabase stek nije verno."
  exit 1
fi
echo "Provera '$mode' je prošla."
