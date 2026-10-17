# Toolchain

Pinned on 2026-10-17 to the newest stable releases that build together. No nightly, beta, or release-candidate runtimes.

| Tool                       | Pin                            | Why this one                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                    | 26.12.0                        | Latest current release. CI uses `actions/setup-node@v7.1.0` with this exact version.                                                                                                                                                                  |
| pnpm                       | 12.14.0                        | `packageManager` field. Latest stable.                                                                                                                                                                                                                |
| TypeScript                 | 7.0.2                          | Latest stable compiler (`tsc`). `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`. typescript-eslint 8.71.2 still loads the TypeScript 6 API, so `pnpm lint` redirects only ESLint's `typescript` import to `@typescript/typescript6@6.0.2`. |
| Rust                       | 1.99.1                         | `rust-toolchain.toml`. Anchor 1.2.1 needs a compiler well above its 1.89 MSRV.                                                                                                                                                                        |
| Agave / Solana CLI         | 4.3.2                          | Newest stable. 4.3.1 is yanked. 4.4 and 4.5 were still beta/alpha.                                                                                                                                                                                    |
| Anchor CLI + `anchor-lang` | 1.2.1 with feature `solana-v4` | Newest stable. 2.0.0-rc.2 is a release candidate, so it is not used. 1.2.1 defaults to the Solana v3 crates, which do not match Agave 4.3, so the program enables `solana-v4`.                                                                        |
| `@solana/kit`              | not a runtime dependency       | Legacy transfer + memo transactions are compiled in `packages/chain`. That keeps the API off `@solana/web3.js`.                                                                                                                                       |
| `@solana/web3.js`          | 1.99.0, Anchor tests only      | `@anchor-lang/core@1.2.1` still speaks the v1 client. 3.x (`next` dist-tag) does not. The web and API do not depend on it.                                                                                                                            |
| `@anchor-lang/core`        | 1.2.1                          | TypeScript client for the phase-2 program tests.                                                                                                                                                                                                      |

The Anchor program is exercised in CI. It is not the custody path. Production escrow is a Squads vault plus the off-chain ledger.

Anchor CLI 1.2.1 runs `anchor test` on surfpool by default. Surfpool is not part of Agave 4.3.2, so CI passes `--validator legacy` and uses `solana-test-validator`. `cargo audit` reads the workspace `Cargo.lock` from the repo root; it has no `--manifest-path` flag.

Development and the escrow verification refuse `mainnet` and `mainnet-beta` cluster names and any RPC URL that contains `mainnet`.
