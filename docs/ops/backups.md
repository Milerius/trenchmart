# Database backups (free tier)

Supabase PITR / paid backups are **declined by owner (free tier)**. Risk: a project wipe or bad
migration is not point-in-time recoverable.

## Nightly encrypted export (GitHub Actions)

`.github/workflows/db-backup.yml` runs daily at 02:17 UTC (and on `workflow_dispatch`). It:

1. `COPY`-style JSONL export of critical tables (`users`, `listings`, `versions`, `orders`,
   `licenses`, `disputes`, `payouts`, `ops_alerts`, `config`) — no R2 blob payloads.
2. Encrypts with [age](https://age-encryption.org) to recipient
   `age1apufn2nv4enzfazcrp2ekx94d6tawxz30zj27lkxs32epwev3q8ssd3w0y` (private key only on the ops
   box: `~/.config/trenchmart/backup-age.key`).
3. Uploads to R2 `trenchmart-files` at `ops/backups/<stamp>.jsonl.age` via wrangler.

### Required GitHub Actions secrets

| Secret                  | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `TM_DATABASE_URL`       | Supabase session-pooler URL (same shape as local `dburl.sh`) |
| `CLOUDFLARE_API_TOKEN`  | Token with R2 edit on `trenchmart-files`                     |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id                                        |

If a secret is missing the job exits 0 and skips (so CI stays green until secrets are set).

### Restore (ops box)

```bash
wrangler r2 object get trenchmart-files/ops/backups/<stamp>.jsonl.age --file /tmp/b.age --remote
age -d -i ~/.config/trenchmart/backup-age.key -o /tmp/b.jsonl /tmp/b.age
# Inspect / re-load rows carefully; this is a logical export, not a full pg_dump.
```
