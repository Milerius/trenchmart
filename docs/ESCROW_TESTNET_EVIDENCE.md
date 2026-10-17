# Escrow devnet evidence

Cluster: devnet. RPC: `https://api.devnet.solana.com`. Mainnet was not used.

> Note (2026-10): `release` now refuses a `Disputed` escrow (it used to allow a permissionless
> release of a disputed escrow after `escrow_until`). Because the upgrade authority of the
> program below is not available, the fixed build is deployed under a new id,
> `Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw`, which the app now uses. The evidence below is
> for the earlier build.

Program [`7Nmxf7QLPUXKha3WQG81GFfXQPYgyXuc5mLfRyUzNzCM`](https://explorer.solana.com/address/7Nmxf7QLPUXKha3WQG81GFfXQPYgyXuc5mLfRyUzNzCM?cluster=devnet). Program data account `93cVchc4nRAbWeEk6YWyBBVCS8ULkde6omakJm7HiV1x` holds 0.89690956 SOL. Deployed in slot 511998341.

| Step            | Transaction                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| deploy write    | [`5odQy8uFpYRoiq5YqYg9WdXFs4A96sTUvmk6dNnnajgFXTN3ALc3v6TC22Qeew2t53tTs22AzL7hQw78EZjK5KE9`](https://explorer.solana.com/tx/5odQy8uFpYRoiq5YqYg9WdXFs4A96sTUvmk6dNnnajgFXTN3ALc3v6TC22Qeew2t53tTs22AzL7hQw78EZjK5KE9?cluster=devnet) |
| deploy write    | [`3atyxyh4CUoiyutxsEm9HkmZEPMW3uU4DmnGoPe2AaWhZ4kDGMP1nFrkjaBiv1h8ZzJkoAg8FWepCC69ygALY2Lv`](https://explorer.solana.com/tx/3atyxyh4CUoiyutxsEm9HkmZEPMW3uU4DmnGoPe2AaWhZ4kDGMP1nFrkjaBiv1h8ZzJkoAg8FWepCC69ygALY2Lv?cluster=devnet) |
| deploy finalize | [`2cpncAGgSsdxNXzNAnieq3pk5g3yenTcPZ6BDBeh5cFjR2rVknMETsqzARe9dDQfiXAFL9vVHdAygNq6KjkZLue3`](https://explorer.solana.com/tx/2cpncAGgSsdxNXzNAnieq3pk5g3yenTcPZ6BDBeh5cFjR2rVknMETsqzARe9dDQfiXAFL9vVHdAygNq6KjkZLue3?cluster=devnet) |

The payer is a throwaway devnet keypair generated for this verification. The secret is not in the repo.

Price 10000000 lamports, fee 500 bps, Trencher rebate 6000 bps. The buyer locked 10200000 lamports. Release paid the seller 10000000 and split the net fee into buyback 80000, ai_verification 50000, ops 40000, and safety 30000. A second order was disputed from `paid` and refunded. A third order expired before it was funded.

| Step                       | Transaction                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| release initialize         | [`3ggB9HrebQB1sNGF7Fbw6rjdMMZrsUkPw7r6jmbm1b3SsByiYBVG98eFK1bPmkvWMNepeSqC36QYfipduTC757Wx`](https://explorer.solana.com/tx/3ggB9HrebQB1sNGF7Fbw6rjdMMZrsUkPw7r6jmbm1b3SsByiYBVG98eFK1bPmkvWMNepeSqC36QYfipduTC757Wx?cluster=devnet) |
| release fund               | [`4CvVrh8Pqcc4sFgWP95h2ytUx9DPeBrhuMwaRv53jQzG2USaV4rSnMGHuhSntEt21hungwr3V2Mz3u9Pn11TTCrp`](https://explorer.solana.com/tx/4CvVrh8Pqcc4sFgWP95h2ytUx9DPeBrhuMwaRv53jQzG2USaV4rSnMGHuhSntEt21hungwr3V2Mz3u9Pn11TTCrp?cluster=devnet) |
| release                    | [`5Nry1VFuvpcM49aYgaZrped1V6JWFt49iWKvvbT2Q1PNgRvrRc8RrHiRR2gTMwubNh9zMG3jnqZ4nZxcgkFW9ai5`](https://explorer.solana.com/tx/5Nry1VFuvpcM49aYgaZrped1V6JWFt49iWKvvbT2Q1PNgRvrRc8RrHiRR2gTMwubNh9zMG3jnqZ4nZxcgkFW9ai5?cluster=devnet) |
| open dispute after release | [`4bhL8xWiqpoUsLn4skNEJQe2u2GLK6w8tKmrGbQzP3xUQXWWyzdn3fjLo1312pdehnbyvndnYj76tkjnPSLnyPUd`](https://explorer.solana.com/tx/4bhL8xWiqpoUsLn4skNEJQe2u2GLK6w8tKmrGbQzP3xUQXWWyzdn3fjLo1312pdehnbyvndnYj76tkjnPSLnyPUd?cluster=devnet) |
| reject dispute             | [`3W7GKQQ4ezsvPdUqPinVRQHpAPJGJkXMfMJanUVfzZxiTzbnjkpM21QvV1QoBLXbTkkusqvb6ooZNmLCi74rQka2`](https://explorer.solana.com/tx/3W7GKQQ4ezsvPdUqPinVRQHpAPJGJkXMfMJanUVfzZxiTzbnjkpM21QvV1QoBLXbTkkusqvb6ooZNmLCi74rQka2?cluster=devnet) |
| refund initialize          | [`3eY8rV8ZxX4FNQS7DLqWxgMoWukyTDiqsZ1UoyEPeggcijm3H7gUQ1JzVoLvxYsLpQYrgmcg2wbXWhS5p3rjuUkd`](https://explorer.solana.com/tx/3eY8rV8ZxX4FNQS7DLqWxgMoWukyTDiqsZ1UoyEPeggcijm3H7gUQ1JzVoLvxYsLpQYrgmcg2wbXWhS5p3rjuUkd?cluster=devnet) |
| refund fund                | [`4EkQbvABE2ywZTtT1DQqPzfyZ3ZktpePxYeehkyN4vUoLdbAuYp5NCwArXJSvatx9zD3HsG4QGPCaiYUvZvEG4XA`](https://explorer.solana.com/tx/4EkQbvABE2ywZTtT1DQqPzfyZ3ZktpePxYeehkyN4vUoLdbAuYp5NCwArXJSvatx9zD3HsG4QGPCaiYUvZvEG4XA?cluster=devnet) |
| open dispute from paid     | [`4WRzmfK9mzKMeUjVDPfVWegvhFrnRRmRgPYGYu5F8NBcA1dZwSNAinshpTY14m8MGCwfcK8XFYuD319mc6yZHWSD`](https://explorer.solana.com/tx/4WRzmfK9mzKMeUjVDPfVWegvhFrnRRmRgPYGYu5F8NBcA1dZwSNAinshpTY14m8MGCwfcK8XFYuD319mc6yZHWSD?cluster=devnet) |
| refund                     | [`4CsWyZbR4tHGd4B5PE3WZ83aaYFPRdGdyzgsKELfJxSSyeyikQby5fhMirogZWW8NaLQzB4ZvTw7AWNJJhmiFyo2`](https://explorer.solana.com/tx/4CsWyZbR4tHGd4B5PE3WZ83aaYFPRdGdyzgsKELfJxSSyeyikQby5fhMirogZWW8NaLQzB4ZvTw7AWNJJhmiFyo2?cluster=devnet) |
| expire initialize          | [`38YFrm1pJ6vXw5oJPu52YuyqFxDriVk6u4S4ndthjxmbcZkF5poEpvoRX5AquZv2Urr3kgjUWg4qCPk7virKUiM3`](https://explorer.solana.com/tx/38YFrm1pJ6vXw5oJPu52YuyqFxDriVk6u4S4ndthjxmbcZkF5poEpvoRX5AquZv2Urr3kgjUWg4qCPk7virKUiM3?cluster=devnet) |
| expire                     | [`bj6fwwGy6buwb2xg1Z2WZNmccd4X9qumhqr8TDjmLfYB5XQJJRKMy8BJeMrEQQVConWSiXyL9Tx5jkaub78qU5W`](https://explorer.solana.com/tx/bj6fwwGy6buwb2xg1Z2WZNmccd4X9qumhqr8TDjmLfYB5XQJJRKMy8BJeMrEQQVConWSiXyL9Tx5jkaub78qU5W?cluster=devnet)   |
