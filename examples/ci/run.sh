#!/usr/bin/env bash
# End-to-end run of the example agents on a local validator + local API (CI's agent-e2e job).
#   ESCROW_SO=path/to/trench_escrow.so ESCROW_PROGRAM_ID=<address> DATABASE_URL=postgres://... bash examples/ci/run.sh
# Needs solana-test-validator on PATH, psql, and pnpm install done. Never touches a public cluster.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${STACK_DIR:-$ROOT/.data/agent-e2e}"
: "${ESCROW_SO:?ESCROW_SO is required}"
: "${ESCROW_PROGRAM_ID:?ESCROW_PROGRAM_ID is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
export ESCROW_PROGRAM_ID
rm -rf "$DIR" && mkdir -p "$DIR"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

cd "$ROOT/examples"
pnpm exec tsx ci/local-stack.ts keys "$DIR"
solana-test-validator --reset --quiet --ledger "$DIR/ledger" \
  --upgradeable-program "$ESCROW_PROGRAM_ID" "$ESCROW_SO" "$DIR/authority.json" >"$DIR/validator.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:8899 -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"ok"' && break
  sleep 1
done
pnpm exec tsx ci/local-stack.ts init "$DIR"

pnpm --dir "$ROOT" --filter @trenchmart/db migrate
# One-minute order TTL: the escrow terms need expires_at <= escrow_until (about 2 minutes here).
psql "$DATABASE_URL" -qc "update config set value = '1'::jsonb where key = 'order_ttl_minutes'"

(
  set -a && . "$DIR/api.env" && set +a
  cd "$ROOT/apps/api" && exec pnpm exec tsx src/node.ts
) >"$DIR/api.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:8787/api/v1/health >/dev/null && break
  sleep 1
done
curl -sf http://127.0.0.1:8787/api/v1/health

pnpm --dir "$ROOT" --filter @trenchmart/sdk build
export TM_API_URL=http://127.0.0.1:8787 TM_RPC_URL=http://127.0.0.1:8899 TM_ESCROW_PROGRAM_ID="$ESCROW_PROGRAM_ID"
TM_VAULT_ADDRESS="$(grep '^VAULT_ADDRESS=' "$DIR/api.env" | cut -d= -f2)"
export TM_VAULT_ADDRESS

echo "== seller agent (no X link): profile, bond, listing, version + scan, price"
TM_KEYPAIR="$DIR/creator.json" TM_DISPLAY_NAME="Seller Agent" TM_BIO="Autonomous seller agent" \
  TM_WEBSITE=example.com TM_CREATE_LISTING=1 TM_PAY_BOND=1 \
  TM_PUBLISH=1 TM_ACCEPT_SUPPLEMENT=1 TM_PRICE_LAMPORTS=20000000 pnpm exec tsx sell-agent.ts

echo "== buyer agent: key, buy, broadcast, download, release after the window, review, upvote, profile"
TM_KEYPAIR="$DIR/buyer.json" TM_WAIT_RELEASE=1 TM_DISPLAY_NAME="Buyer Agent" \
  TM_BIO="Autonomous buyer agent" pnpm exec tsx buy-agent.ts

echo "== seller agent: sales, subscribers, reply to the review"
TM_KEYPAIR="$DIR/creator.json" TM_REPLY="Thanks for the review, agent to agent." pnpm exec tsx sell-agent.ts

pnpm exec tsx ci/check.ts "$DIR"
