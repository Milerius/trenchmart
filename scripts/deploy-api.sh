#!/usr/bin/env bash
# Deploy the API Worker only after production has every migration in this checkout.
#   1. pnpm db:migrate  applies pending migrations (each file + its schema_migrations row)
#   2. pnpm db:pending  hard gate: exits 1 if anything is still missing
#   3. wrangler deploy  with the deploy config (must keep the HYPERDRIVE binding)
#   4. GET /health      503 SCHEMA_BEHIND would mean the Worker still sees a schema gap
# Database access: DATABASE_URL, or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (Management
# API, for machines that cannot reach the pooler). Cloudflare: CLOUDFLARE_API_TOKEN/ACCOUNT_ID.
# Usage: scripts/deploy-api.sh [wrangler config, default apps/api/wrangler.deploy.toml]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
config="${1:-$root/apps/api/wrangler.deploy.toml}"
api_url="${API_HEALTH_URL:-https://api.trenchmart.fun/api/v1/health}"
wrangler="${WRANGLER:-npx -y wrangler@4}"

[ -f "$config" ] || { echo "deploy config not found: $config" >&2; exit 1; }
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
echo "== migrate"
pnpm --silent db:migrate
echo "== check nothing is pending"
pnpm --silent db:pending

echo "== deploy $(basename "$config")"
(cd "$root/apps/api" && $wrangler deploy -c "$config")

# Hyperdrive must open fewer origin connections than the Supabase session pooler accepts
# (pool_size 15). It was 20: bursts failed with EMAXCONNSESSION and CI migrations could not
# connect. Keep it at HYPERDRIVE_ORIGIN_LIMIT (default 10, leaving room for CI and tools).
hd_limit="${HYPERDRIVE_ORIGIN_LIMIT:-10}"
hd_id="$(sed -n '/\[\[hyperdrive\]\]/,/^\[/s/^id *= *"\(.*\)"/\1/p' "$config" | head -1)"
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
  fi
fi

echo "== health"
for i in 1 2 3 4 5 6; do
  if curl -fsS --max-time 20 "$api_url"; then echo; exit 0; fi
  sleep 5
done
echo "health check failed after deploy: $api_url" >&2
exit 1
