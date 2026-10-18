#!/usr/bin/env bash
# Tests for scripts/deploy-api.sh with fake pnpm, wrangler and curl (no network, no database).
# Run: bash scripts/deploy-api.test.sh
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
REF=abcdefghijklmnopqrst
OTHER=zyxwvutsrqponmlkjihg

cat >"$work/bin/pnpm" <<'SH'
#!/usr/bin/env bash
echo "pnpm $* DATABASE_URL=${DATABASE_URL:-<none>} REF=${SUPABASE_PROJECT_REF:-<none>}" >>"$FAKE_LOG"
case "$*" in
  *db:pending*) [ "${FAKE_PENDING_FAIL:-0}" = 1 ] && { echo "PENDING migrations" >&2; exit 1; } ;;
esac
exit 0
SH
cat >"$work/bin/wrangler" <<'SH'
#!/usr/bin/env bash
echo "wrangler $*" >>"$FAKE_LOG"
case "$1 $2" in
  'hyperdrive get')
    [ "${FAKE_HD_FAIL:-0}" = 1 ] && exit 1
    printf 'note\n{"id":"hd","origin":{"host":"aws-0-ap-south-1.pooler.supabase.com","user":"%s"},"origin_connection_limit":10}\n' "$FAKE_HD_USER" ;;
esac
exit 0
SH
cat >"$work/bin/curl" <<'SH'
#!/usr/bin/env bash
echo "curl $*" >>"$FAKE_LOG"
printf '%s' "$FAKE_HEALTH"
SH
chmod +x "$work/bin/"*

cat >"$work/wrangler.toml" <<'TOML'
name = "trenchmart-api"
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "hd-test"
[placement]
region = "aws:ap-south-1"
TOML

pass=0
fail=0
# run <name> <expected exit: 0|nonzero> [VAR=value ...]; leaves the call log in $log.
run() {
  local name="$1" want="$2"
  shift 2
  log="$work/$name.log"
  : >"$log"
  env PATH="$work/bin:$PATH" WRANGLER="$work/bin/wrangler" FAKE_LOG="$log" HOME="$work/home" \
    TM_DEPLOY_DB_ENV="$work/prod.env" FAKE_HD_USER="postgres.$REF" HEALTH_RETRY_SLEEP=0 \
    FAKE_HEALTH='{"ok":true,"cluster":"devnet"}' API_HEALTH_URL=https://api.test/api/v1/health \
    "$@" bash "$root/scripts/deploy-api.sh" "$work/wrangler.toml" >"$work/$name.out" 2>&1
  local code=$?
  if { [ "$want" = 0 ] && [ "$code" = 0 ]; } || { [ "$want" != 0 ] && [ "$code" != 0 ]; }; then
    return 0
  fi
  echo "FAIL $name: exit $code (want $want)"
  sed 's/^/    /' "$work/$name.out"
  fail=$((fail + 1))
  return 1
}
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; sed 's/^/    /' "$log"; }
has() { grep -q -- "$1" "$log"; }

prod_env() { printf 'SUPABASE_ACCESS_TOKEN=sbp_test\nSUPABASE_PROJECT_REF=%s\n%s' "$1" "${2:-}" >"$work/prod.env"; }

# 1. An inherited DATABASE_URL (local tests) is ignored: migrate and pending both target prod.
prod_env "$REF"
if run inherited 0 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/trenchmart \
  PGHOST=127.0.0.1 SUPABASE_PROJECT_REF="$OTHER"; then
  if has "db:migrate DATABASE_URL=<none> REF=$REF" && has "db:pending DATABASE_URL=<none> REF=$REF" &&
    ! grep -q 127.0.0.1 "$log" && ! grep -q "$OTHER" "$log"; then
    ok "inherited DATABASE_URL / PG* / SUPABASE_* are ignored; prod target from the env file"
  else bad "inherited DATABASE_URL leaked into a DB command"; fi
fi

# 2. Order: migrate, pending, then deploy; health ok.
order="$(grep -o -e 'db:migrate' -e 'db:pending' -e 'wrangler deploy' "$log" | tr '\n' '|')"
if [ "$order" = "db:migrate|db:pending|wrangler deploy|" ]; then
  ok "migrate, then pending, then deploy"
else bad "wrong order"; fi

# 3. Env file on another project than the Worker's Hyperdrive: refuse before migrating.
prod_env "$OTHER"
if run wrong-project 1; then
  if ! has db:migrate && ! has 'wrangler deploy'; then ok "another Supabase project is refused before any migration"
  else bad "migrated or deployed against the wrong project"; fi
fi

# 4. TM_PROD_SUPABASE_REF pin mismatch: refuse.
prod_env "$REF"
if run pin-mismatch 1 TM_PROD_SUPABASE_REF="$OTHER"; then
  ! has db:migrate && ok "TM_PROD_SUPABASE_REF mismatch refused" || bad "pin ignored"
fi

# 5. Hyperdrive unreadable: fail closed.
if run hd-unreadable 1 FAKE_HD_FAIL=1; then
  ! has db:migrate && ok "unreadable Hyperdrive fails closed" || bad "migrated without confirming"
fi

# 6. Missing env file: refuse.
rm -f "$work/prod.env"
if run no-env 1; then ! has db:migrate && ok "missing production env file refused" || bad "ran without env"; fi

# 7. A DATABASE_URL in the env file must be on the same project.
prod_env "$REF" "DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres"
if run file-url-local 1; then ! has db:migrate && ok "env-file DATABASE_URL on another host refused" || bad "local URL accepted"; fi
prod_env "$REF" "DATABASE_URL=postgresql://postgres.$REF:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
if run file-url-pooler 0; then has "db:migrate DATABASE_URL=postgresql://postgres.$REF" && ok "env-file pooler URL on the project accepted" || bad "pooler URL not used"; fi
prod_env "$REF" "DATABASE_URL=postgresql://postgres.$OTHER:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
if run file-url-other 1; then ! has db:migrate && ok "env-file pooler URL of another project refused" || bad "other project URL accepted"; fi

# 8. Still pending after migrate: no deploy.
prod_env "$REF"
if run pending 1 FAKE_PENDING_FAIL=1; then
  ! has 'wrangler deploy' && ok "pending migrations block the deploy" || bad "deployed with pending migrations"
fi

# 9. Health answers SCHEMA_BEHIND after deploy: the run fails and says so.
if run schema-behind 1 FAKE_HEALTH='{"ok":false,"code":"SCHEMA_BEHIND","pending":["0099_x.sql"]}'; then
  grep -q SCHEMA_BEHIND "$work/schema-behind.out" && ok "SCHEMA_BEHIND health fails the deploy" || bad "no SCHEMA_BEHIND message"
fi

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
