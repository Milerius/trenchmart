#!/usr/bin/env bash
# Deploy the API Worker only after PRODUCTION has every migration in this checkout.
#   0. Production target, loaded explicitly: an inherited DATABASE_URL (or PG*/SUPABASE_*
#      variable) is ignored; the target comes only from TM_DEPLOY_DB_ENV (default
#      ~/.config/trenchmart/supabase.env). It must be the Supabase project the Worker's
#      Hyperdrive connects to (origin user postgres.<ref> or host db.<ref>.supabase.co), and
#      TM_PROD_SUPABASE_REF, when set, too. Anything else refuses to migrate or deploy.
#   1. pnpm db:migrate  applies pending migrations to that target
#   2. pnpm db:pending  hard gate against the same target: exits 1 if anything is missing
#   3. wrangler deploy  with the deploy config (must keep the HYPERDRIVE binding)
#   4. GET /health      503 SCHEMA_BEHIND (the Worker still sees a schema gap) fails the run
#   5. Hyperdrive limit kept <= 10 and, with INTERNAL_TOKEN set, reported to the ops check
# The env file holds SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (Management API) and,
# optionally, a DATABASE_URL on that same project. Cloudflare: CLOUDFLARE_API_TOKEN/ACCOUNT_ID.
# Usage: scripts/deploy-api.sh [wrangler config, default apps/api/wrangler.deploy.toml]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
config="${1:-$root/apps/api/wrangler.deploy.toml}"
api_url="${API_HEALTH_URL:-https://api.trenchmart.fun/api/v1/health}"
wrangler="${WRANGLER:-npx -y wrangler@4}"

[ -f "$config" ] || { echo "deploy config not found: $config" >&2; exit 1; }
# Absolute: wrangler runs from apps/api, so a relative path would resolve there.
config="$(cd "$(dirname "$config")" && pwd)/$(basename "$config")"
grep -q 'binding *= *"HYPERDRIVE"' "$config" || {
  echo "$config has no HYPERDRIVE binding; refusing to deploy" >&2
  exit 1
}

# Keep the Worker next to the database (Supabase, aws ap-south-1). Without placement it runs
# next to each visitor and every Postgres round trip crosses the world (studio took ~10 s).
# Older local deploy configs lack the block, so add it to a temporary copy instead of failing.
if ! grep -q '^\[placement\]' "$config"; then
  placed="$root/apps/api/.wrangler.deploy.placed.toml"
  { cat "$config"; printf '\n[placement]\nregion = "aws:ap-south-1"\n'; } >"$placed"
  trap 'rm -f "$placed"' EXIT
  echo "note: $(basename "$config") has no [placement]; deploying with region aws:ap-south-1"
  config="$placed"
fi

cd "$root"

# --- 0. production migration target -------------------------------------------------------
# Never trust the caller's environment for the database: a DATABASE_URL left over from local
# tests once migrated a local Postgres while the Worker shipped to production (2026-10-18).
unset DATABASE_URL PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE \
  SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD
db_env="${TM_DEPLOY_DB_ENV:-$HOME/.config/trenchmart/supabase.env}"
[ -f "$db_env" ] || { echo "refusing: production DB env file not found: $db_env" >&2; exit 1; }
target_ref="$(set -a; . "$db_env"; printf '%s' "${SUPABASE_PROJECT_REF:-}")"
target_url="$(set -a; . "$db_env"; printf '%s' "${DATABASE_URL:-}")"
case "$target_ref" in
  '' | *[!a-z0-9]*) echo "refusing: SUPABASE_PROJECT_REF missing or malformed in $db_env" >&2; exit 1 ;;
esac
if [ -n "${TM_PROD_SUPABASE_REF:-}" ] && [ "$target_ref" != "$TM_PROD_SUPABASE_REF" ]; then
  echo "refusing: $db_env targets another Supabase project than TM_PROD_SUPABASE_REF" >&2
  exit 1
fi
if [ -n "$target_url" ]; then
  # A direct URL is allowed only on that project: db.<ref>.supabase.co or the pooler as
  # postgres.<ref>. Parsed, never printed.
  url_ok="$(TARGET_URL="$target_url" REF="$target_ref" node -e '
    try {
      const u = new URL(process.env.TARGET_URL), ref = process.env.REF;
      const direct = u.hostname === `db.${ref}.supabase.co`;
      const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) &&
        decodeURIComponent(u.username) === `postgres.${ref}`;
      console.log(direct || pooler ? "ok" : "no");
    } catch { console.log("no"); }')"
  if [ "$url_ok" != ok ]; then
    echo "refusing: DATABASE_URL in $db_env is not on Supabase project $target_ref" >&2
    exit 1
  fi
fi

# The Worker's database is whatever its Hyperdrive points at: the migration target must be
# that same project, or migrating would not fix what production reads. Fails closed.
hd_id="$(sed -n '/\[\[hyperdrive\]\]/,/^\[/s/^id *= *"\(.*\)"/\1/p' "$config" | head -1)"
[ -n "$hd_id" ] || { echo "refusing: no Hyperdrive id in $(basename "$config")" >&2; exit 1; }
hd_match="$(cd "$root/apps/api" && $wrangler hyperdrive get "$hd_id" 2>/dev/null |
  REF="$target_ref" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try {
      const o = JSON.parse(s.slice(s.indexOf("{"))).origin ?? {}, ref = process.env.REF;
      const ok = o.user === `postgres.${ref}` || o.host === `db.${ref}.supabase.co`;
      console.log(ok ? "ok" : "no");
    } catch { console.log("unknown"); }})')" || hd_match=unknown
case "$hd_match" in
  ok) echo "== migration target: Supabase project $target_ref (same as the Worker's Hyperdrive)" ;;
  no) echo "refusing: $db_env is not the database the Worker's Hyperdrive uses" >&2; exit 1 ;;
  *) echo "refusing: could not read Hyperdrive $hd_id to confirm the production database" >&2; exit 1 ;;
esac

# Every DB command gets exactly this target: the env file, nothing inherited.
prod_db() {
  (
    set -a
    # shellcheck disable=SC1090
    . "$db_env"
    set +a
    pnpm --silent "$@"
  )
}

echo "== migrate (production)"
prod_db db:migrate
echo "== check nothing is pending (production)"
prod_db db:pending

echo "== deploy $(basename "$config")"
(cd "$root/apps/api" && $wrangler deploy -c "$config")

# Hyperdrive must open fewer origin connections than the Supabase session pooler accepts
# (pool_size 15). It was 20: bursts failed with EMAXCONNSESSION and CI migrations could not
# connect. Keep it at HYPERDRIVE_ORIGIN_LIMIT (default 10, leaving room for CI and tools).
hd_limit="${HYPERDRIVE_ORIGIN_LIMIT:-10}"
if [ -n "$hd_id" ]; then
  echo "== hyperdrive origin_connection_limit (want <= $hd_limit)"
  current="$(cd "$root/apps/api" && $wrangler hyperdrive get "$hd_id" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("{")));console.log(j.origin_connection_limit ?? "unset")})')" || current=unknown
  echo "current: $current"
  if [ "$current" = "unknown" ]; then
    echo "warning: could not read the Hyperdrive config; check its origin_connection_limit" >&2
  elif [ "$current" = "unset" ] || [ "$current" -gt "$hd_limit" ]; then
    (cd "$root/apps/api" && $wrangler hyperdrive update "$hd_id" --origin-connection-limit "$hd_limit" >/dev/null)
    echo "set to $hd_limit"
    current="$hd_limit"
  fi
fi

echo "== health"
# A mainnet config before launch (MAINNET_LAUNCHED = "0") must answer MAINNET_REFUSED: the
# Worker is deployed but fails closed. Anything else from it (even ok) fails the run.
prelaunch=0
if grep -Eq '^SOLANA_CLUSTER *= *"mainnet(-beta)?"' "$config" &&
  ! grep -Eq '^MAINNET_LAUNCHED *= *"1"' "$config"; then
  prelaunch=1
fi
healthy=0
health_body=''
for i in 1 2 3 4 5 6; do
  health_body="$(curl -sS --max-time 20 "$api_url" 2>/dev/null)" || health_body=''
  case "$health_body" in
    *SCHEMA_BEHIND*) ;;
    *MAINNET_REFUSED*)
      if [ "$prelaunch" = 1 ]; then
        echo "mainnet Worker fails closed as expected before launch (MAINNET_REFUSED)"
        healthy=1
        break
      fi
      ;;
    *'"ok":true'*)
      if [ "$prelaunch" = 1 ]; then
        echo "refusing: pre-launch mainnet Worker answered ok: $health_body" >&2
        exit 1
      fi
      printf '%s\n' "$health_body"; healthy=1; break ;;
  esac
  sleep "${HEALTH_RETRY_SLEEP:-5}"
done
if [ "$healthy" != 1 ]; then
  case "$health_body" in
    *SCHEMA_BEHIND*) echo "health: SCHEMA_BEHIND, the Worker sees unapplied migrations: $health_body" >&2 ;;
    *) echo "health check failed after deploy: $api_url" >&2 ;;
  esac
  exit 1
fi

# Tell the ops check what the limit is now (HYPERDRIVE_LIMIT alert; the Worker cannot read
# the Hyperdrive config itself). Needs INTERNAL_TOKEN; best effort.
if [ -n "${hd_id:-}" ] && [ -n "${INTERNAL_TOKEN:-}" ]; then
  case "$current" in
    '' | *[!0-9]*) hd_json='{"limit":null,"source":"deploy","error":"'"$current"'"}' ;;
    *) hd_json='{"limit":'"$current"',"source":"deploy"}' ;;
  esac
  curl -fsS --max-time 20 -o /dev/null -X POST "${api_url%/health}/internal/ops/hyperdrive" \
    -H "Authorization: Bearer $INTERNAL_TOKEN" -H 'content-type: application/json' \
    --data "$hd_json" && echo "reported hyperdrive limit $current to the ops check" ||
    echo "warning: could not report the Hyperdrive limit to the ops check" >&2
fi
