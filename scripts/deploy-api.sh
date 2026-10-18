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

cd "$root"
echo "== migrate"
pnpm --silent db:migrate
echo "== check nothing is pending"
pnpm --silent db:pending

echo "== deploy $(basename "$config")"
(cd "$root/apps/api" && $wrangler deploy -c "$config")

echo "== health"
for i in 1 2 3 4 5 6; do
  if curl -fsS --max-time 20 "$api_url"; then echo; exit 0; fi
  sleep 5
done
echo "health check failed after deploy: $api_url" >&2
exit 1
