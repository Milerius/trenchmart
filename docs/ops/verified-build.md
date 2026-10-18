# Verified (reproducible) build — trench_escrow

Program id (devnet): `Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw`  
Anchor: `1.2.1` · Agave/solana CLI metadata: `4.3.0` (Docker image tag; CI Solana CLI install stays 4.3.2) (`[workspace.metadata.cli]` in root `Cargo.toml`)  
Upgrade authority: Squads vault PDA `47RLqPda5YLW7rFHkoJ2K5yACWu4qc7j2yYU2so64bz7` (2-of-3 multisig `CaatcAQa…`)

## CI job

`.github/workflows/solana-verify.yml` runs `solana-verify build --library-name trench_escrow` in
Docker, prints the executable hash, dumps the on-chain program from devnet, and compares the two.
It uploads `target/deploy/trench_escrow.so` as an artifact (`trench_escrow-verified-<sha>`).

Trigger: push/PR that touches the program, or **Actions → solana-verify → Run workflow**.

A mismatch is expected when `main` has moved past the commit that was last upgraded on chain
(panic line numbers alone change the binary). Tag releases as `escrow-v*` only from the commit
you actually deploy; the job **fails** on mismatch for those tags.

## Deploy from a verified artifact (devnet / Squads)

1. Download the artifact from the green `solana-verify` run for the commit you want.
2. Write a buffer and create a Squads program-upgrade proposal (same path used for v2):

   ```bash
   solana program write-buffer target/deploy/trench_escrow.so \
     --url https://solana-devnet.api.onfinality.io/public \
     --buffer-authority <member-or-deployer>
   # Then propose/approve/execute the upgrade with the Squads vault as upgrade authority.
   ```

3. After execute, re-run `solana-verify` on that tag/commit — hashes must match.
4. Do **not** redeploy with plain `anchor build` / `anchor upgrade` if you want the verified hash.

## Submit verification (OtterSec / explorer badge)

OtterSec's hosted verifier (`solana-verify remote submit-job`) is **mainnet only**. On devnet the
CI comparison + artifact are the proof.

When the program is on mainnet and the upgrade authority can sign:

```bash
# 1) Build the same commit in Docker (or download the CI artifact and confirm the hash).
solana-verify build --library-name trench_escrow \
  --base-image solanafoundation/solana-verifiable-build:4.3.0

# 2) Upload the verify PDA (signer = upgrade authority, or a Squads verify flow).
solana-verify verify-from-repo \
  --program-id <MAINNET_PROGRAM_ID> \
  --commit-hash <git sha of the deploy> \
  --library-name trench_escrow \
  --url https://api.mainnet-beta.solana.com \
  --skip-prompt \
  https://github.com/Milerius/trenchmart

# 3) Queue OtterSec remote rebuild (explorer “Verified” badge).
solana-verify remote submit-job \
  --program-id <MAINNET_PROGRAM_ID> \
  --uploader <pubkey that uploaded the PDA>

solana-verify remote get-job --job-id <job-id>
```

For a Squads-controlled upgrade authority, follow Solana's
[multisig verification](https://solana.com/docs/programs/verified-builds) notes (export the PDA
transaction for co-signers). Until mainnet launch, skip OtterSec and rely on the CI hash compare.

## Local (needs Docker)

```bash
cargo install solana-verify --locked   # or curl the release binary used in CI
solana-verify build --library-name trench_escrow \
  --base-image solanafoundation/solana-verifiable-build:4.3.0
solana-verify get-executable-hash target/deploy/trench_escrow.so
solana-verify get-executable-hash <(solana program dump Dbrq2s… -u <devnet-rpc> /dev/stdout)
```
