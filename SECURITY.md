# Security policy

TrenchMart is a devnet proof of concept. It runs on Solana **devnet only** and never asks for a seed phrase or private key.

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/Milerius/trenchmart/security/advisories/new). Please include steps to reproduce. We reply within 72 hours.

## On-chain program

`trench_escrow` (devnet `Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw`) embeds a [security.txt](https://github.com/neodyme-labs/solana-security-txt) and publishes its IDL on chain. Source: `programs/trench_escrow`.

## What the site asks your wallet to sign

- **Sign in:** a Sign-In With Solana message for `trenchmart.fun`. It is not a transaction.
- **Buy:** a single transaction, with you as the only signer and fee payer. It contains:
  - compute-budget limits
  - `trench_escrow::initialize` and `fund`, which move the price into a per-order escrow account
  - a memo with the order id
- **Bond and verification fee:** a system transfer to the treasury vault, with a memo.

Buy, bond and verification-fee transactions are simulated on devnet before your wallet is asked to sign them. So is the dispute transaction you can re-request from your purchases page. The first dispute transaction is returned when your dispute is recorded and is not simulated by us; your wallet still simulates it. If the RPC is unreachable we skip our simulation, and the wallet's own check still applies.
