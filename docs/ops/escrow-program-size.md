# trench_escrow program size

Measured 2026-10-22 (UTC+4). Rent is `solana rent <bytes>` (Solana CLI 4.3.2) for the `.so` bytes; a
deployed ProgramData account holds 45 more bytes.

Rule: no feature, check or error code was removed, and `overflow-checks = true` stays.

## Each step (local `anchor build`, Agave 4.3.2 platform tools, SBPF v3)

| Step                                                                                                                                     | `.so` bytes |       Rent SOL |             Delta | Kept? |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------: | -------------: | ----------------: | ----- |
| Baseline `main` (`opt-level="z"`, `lto="fat"`, `codegen-units=1` already set)                                                            |     248,232 |     1.26166880 |                   |       |
| `opt-level = "s"`                                                                                                                        |     254,496 |     1.29348992 |            +6,264 | no    |
| `opt-level = 3`                                                                                                                          |     275,704 |     1.40122656 |           +27,472 | no    |
| `lto = false` (same size: LTO was not running, see next rows)                                                                            |     247,832 |     1.25963680 |              -400 | no    |
| `codegen-units = 16`                                                                                                                     |     256,568 |     1.30401568 |            +8,336 | no    |
| `cargo build-sbf --optimize-size`                                                                                                        |     256,872 |     1.30556000 |            +8,640 | no    |
| `strip = true` (cargo-build-sbf already strips)                                                                                          |        same |           same |                 0 | no    |
| **`crate-type = ["cdylib"]`** (a mixed cdylib+lib crate silently disables fat LTO)                                                       |     223,104 |     1.13401856 |           -25,128 | yes   |
| cdylib + `lto = "thin"`                                                                                                                  |     241,488 |     1.22740928 | +18,384 vs cdylib | no    |
| cdylib + `opt-level = "s"`                                                                                                               |     233,848 |     1.18859808 | +10,744 vs cdylib | no    |
| **Hand-read ProgramData in `init_config`** instead of `Account<ProgramData>` (drops bincode/serde deserialize and core float formatting) |     171,816 |     0.87347552 |           -51,288 | yes   |
| **`panic = "abort"`**                                                                                                                    |     171,696 |     0.87286592 |              -120 | yes   |
| **`no-log-ix-name`** by default (drops the `Instruction: X` log line; nothing parses it)                                                 | **170,912** | **0.86888320** |              -784 | yes   |

Not done, and why:

- `no-idl`: Anchor 1.x has no on-chain IDL instruction, so the flag does nothing.
- `custom-panic`: the default Solana panic handler already logs without `core::fmt`.
- Zero-copy `Escrow`: changes the account API and the client decoders and would need test changes.
  The Borsh layout is already packed, so it would save code only.
- The program has no `msg!` calls and no events. Errors are numeric codes already.

## Verified build (what is deployed)

`solana-verify build` (Docker image 4.3.0) builds SBPF v0, which adds relocations:

|                                                   | `.so` bytes |       Rent SOL |
| ------------------------------------------------- | ----------: | -------------: |
| `main` verified build (devnet before this change) |     268,168 |     1.36294368 |
| This change, verified build                       | **183,928** | **0.93500448** |

## Mainnet one-time cost, fresh deploy with `--max-len 183928`

| Account                                              |   Bytes |            SOL |
| ---------------------------------------------------- | ------: | -------------: |
| ProgramData (stays locked)                           | 183,973 |     0.93523308 |
| Program (stays locked)                               |      36 |     0.00083312 |
| Buffer (refunded when the deploy finalizes)          | 183,965 |     0.93519244 |
| **Peak needed** (plus about 0.001 SOL in write fees) |         | **1.87125864** |
| **Locked while the program exists**                  |         | **0.93606620** |

Before this change the same deploy locked 1.36400540 SOL and needed a 2.72713704 SOL peak.

ProgramData can only grow. The devnet account stays 268,168 bytes; the new code sits in it.

## Compute units (Mollusk, same 102-test suite, happy paths)

| Instruction          | Before |  After |
| -------------------- | -----: | -----: |
| initialize (median)  | 14,664 | 12,585 |
| fund                 |  8,886 |  7,531 |
| release              |  9,427 |  7,903 |
| open_dispute         |  8,652 |  7,485 |
| refund               |  9,214 |  7,894 |
| reject_dispute       |  8,668 |  7,506 |
| refund_after_timeout |  8,894 |  7,660 |
| expire               |  5,600 |  4,763 |
| close                |  4,947 |  4,019 |
| init_config          | 16,931 | 11,508 |
| set_config           |  5,513 |  4,673 |

Across all 526 program invocations in the suite, no instruction used more CU than before.
