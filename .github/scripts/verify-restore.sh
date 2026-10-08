#!/usr/bin/env bash
# Poredi dump sa bazom u koju je vraćen.
#
#   PSQL="docker exec -i proba psql -U postgres -d postgres" \
#     .github/scripts/verify-restore.sh dump.sql
#
# `PSQL` je komanda koja otvara vezu sa vraćenom bazom (bez `-c`).
#
# Presuđuje se samo ono što se sa sigurnošću može tvrditi:
#  - svaka tabela iz dumpa postoji u vraćenoj bazi i ima tačno onoliko redova
#    koliko ih fajl nosi;
#  - ograničenje `appointments_no_overlap` postoji. To je jedina odbrana od
#    dvostrukog zakazivanja, a bez proširenja `btree_gist` ono se pri vraćanju
#    tiho odbije — baza bez njega izgleda ispravno dok ne dođe prvo dvostruko
#    zakazivanje.
# Broj RLS-a, politika, funkcija, ograničenja, indeksa i okidača se poredi
# isto, ali se prijavljuje kao upozorenje: vraćanje u običan Postgres ume da
# odbije objekat koji zavisi od Supabase-a (role, proširenja), pa razlika tu ne
# znači nužno da je kopija kvarna. Kad se vidi stvaran izlaz noćnog posla, ovo
# se može pooštriti.

set -euo pipefail

dump="${1:?Potreban je putanja do dumpa}"
: "${PSQL:?Potrebna je promenljiva PSQL}"

# shellcheck disable=SC2086
q() { $PSQL -tAc "$1"; }

failed=0
warned=0

fail() {
  echo "  ✗ $1"
  failed=1
}

warn() {
  echo "  ! $1"
  echo "::warning::Proba vraćanja: $1"
  warned=1
}

# Koliko redova fajl nosi za datu tabelu — broji se blok između
# `COPY ... FROM stdin;` i završnog `\.`.
rows_in_file() {
  awk -v t="$1" '
    $0 ~ "^COPY \"public\".\""t"\" " { u=1; next }
    u && $0 == "\\." { u=0 }
    u { n++ }
    END { print n+0 }
  ' "$dump"
}

tables=$(grep -o '^CREATE TABLE "public"\."[^"]*"' "$dump" | sed -E 's/.*\."([^"]*)"/\1/' | sort -u)

if [ -z "$tables" ]; then
  echo "U dumpu nema nijedne tabele iz šeme public."
  exit 1
fi

echo "Tabele ($(echo "$tables" | wc -l | tr -d ' ')):"
for t in $tables; do
  in_file=$(rows_in_file "$t")
  in_db=$(q "select count(*) from public.\"$t\"" 2>/dev/null || echo "NEMA")

  if [ "$in_file" = "$in_db" ]; then
    echo "  ✓ $t: $in_db"
  else
    fail "$t: u fajlu $in_file, u vraćenoj bazi $in_db"
  fi
done

# Objekti. Fajl i baza se broje nezavisno; razlika je upozorenje, ne pad.
count_in_file() { grep -cE "$1" "$dump" || true; }

compare() {
  local name="$1" in_file="$2" in_db="$3"
  if [ "$in_file" = "$in_db" ]; then
    echo "  ✓ $name: $in_db"
  else
    warn "$name: u fajlu $in_file, u vraćenoj bazi $in_db"
  fi
}

echo "Objekti:"
compare "RLS uključen" \
  "$(count_in_file '^ALTER TABLE "public"\."[^"]*" ENABLE ROW LEVEL SECURITY;')" \
  "$(q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")"

compare "politike" \
  "$(count_in_file '^CREATE POLICY "[^"]*" ON "public"\.')" \
  "$(q "select count(*) from pg_policies where schemaname='public'")"

# Ograničenja su u dumpu na dva mesta: `ADD CONSTRAINT` posle tabele, i
# `CONSTRAINT ... CHECK` unutar same `CREATE TABLE` naredbe. Broje se samo ona
# iz šeme public; `auth` ima svoja, a vraća se u istu bazu.
constraints_in_file() {
  awk '
    /^CREATE TABLE "/ { in_create = ($0 ~ /^CREATE TABLE "public"\./) }
    /^\);/ { in_create = 0 }
    /^ALTER TABLE( ONLY)? "/ { alter_public = ($0 ~ /^ALTER TABLE( ONLY)? "public"\./) }
    in_create && /^    CONSTRAINT / { n++ }
    alter_public && /^    ADD CONSTRAINT / { n++ }
    END { print n+0 }
  ' "$dump"
}

compare "ograničenja" \
  "$(constraints_in_file)" \
  "$(q "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype in ('p','u','c','x','f') and c.conrelid <> 0")"

compare "okidači" \
  "$(count_in_file '^CREATE( CONSTRAINT)? TRIGGER .* ON "public"\.')" \
  "$(q "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal")"

compare "funkcije" \
  "$(count_in_file '^CREATE FUNCTION "public"\.')" \
  "$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype in ('e','i'))")"

compare "indeksi (van ograničenja)" \
  "$(count_in_file '^CREATE( UNIQUE)? INDEX "[^"]*" ON "public"\.')" \
  "$(q "select count(*) from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not exists (select 1 from pg_constraint k where k.conindid=i.indexrelid)")"

echo "Ograničenja koja ne smeju da nestanu:"
overlap=$(q "select count(*) from pg_constraint where conname='appointments_no_overlap' and contype='x' and conrelid='public.appointments'::regclass" 2>/dev/null || echo 0)
if [ "$overlap" = "1" ]; then
  echo "  ✓ appointments_no_overlap"
else
  fail "appointments_no_overlap nije vraćeno — bez njega baza ne sprečava dvostruko zakazivanje"
fi

if [ "$failed" -ne 0 ]; then
  echo "Vraćanje nije verno — kopija se ne sme smatrati ispravnom."
  exit 1
fi

if [ "$warned" -ne 0 ]; then
  echo "Vraćanje je verno po redovima, uz upozorenja o objektima (vidi gore)."
else
  echo "Vraćanje provereno: svaka tabela i svaki red iz kopije je u bazi."
fi
