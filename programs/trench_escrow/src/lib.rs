//! TrenchMart per-order SOL escrow.
//!
//! One `Escrow` PDA per order, at `["escrow", buyer, order_id]` (v2; v1 escrows used
//! `["escrow", order_id]` and keep working). The buyer creates and funds it in
//! one transaction; after `escrow_until` anyone may crank `release`, which pays the seller the
//! price and the four fee buckets their split of the net fee. Inside the window the buyer can
//! `open_dispute`, which freezes the funds until the resolver either `refund`s the buyer or
//! `reject_dispute`s back to the prior state.
//!
//! v2 (security review M-01, M-02, L-01, L-02, L-04, I-04):
//! - The dispute resolver lives in a program-wide `Config` PDA (`["config"]`), set by the
//!   program's upgrade authority and rotatable by the config admin. `refund`,
//!   `reject_dispute` and resolver-side `open_dispute` authorize against `config.resolver`, never against the
//!   `resolver` stored in the escrow (kept only as a record), so a lost or leaked resolver
//!   key can be replaced for every in-flight escrow.
//! - `open_dispute` also accepts `config.resolver`: it can open the dispute on chain the moment the buyer files it,
//!   so a permissionless `release` can no longer race an off-chain dispute (M-01).
//! - `refund_after_timeout`: if a dispute is still open `config.dispute_timeout` seconds
//!   after `escrow_until`, anyone can return the deposit to the buyer (M-02 fallback).
//! - `close`: terminal escrows can be closed and their rent returned to the buyer (L-01).
//! - `initialize` refuses incoherent terms (L-04).
//!
//! # Invariants (each one is exercised in `tests/escrow.rs`)
//!
//! 1. **Funds only leave to stored parties.** Lamports leave an escrow only in `release`
//!    (to `seller` and the four buckets, each pinned by an `address = escrow.<field>`
//!    constraint) or `refund` (to `buyer`, pinned the same way). No instruction takes a
//!    destination from its arguments, and no instruction pays the resolver.
//! 2. **Exactly the deposit moves, never the rent.** `fund` moves `quote().total` in;
//!    `release` moves `price + net_fee == total` out; `refund` moves `deposit` out. The
//!    rent-exempt floor paid at `initialize` stays behind until `close` returns it to the
//!    buyer once the escrow is terminal.
//! 3. **One terminal exit per escrow.** The state machine in `state.rs` has no edge out of
//!    `Refunded` or `Expired`, and `release` runs only from `Paid`, so funds leave at most once.
//! 4. **Time gates.** `fund` only until `expires_at`; `release` only from `escrow_until`;
//!    a `Paid` escrow can be disputed only before `escrow_until`; `expire` only after
//!    `expires_at` and only for an unfunded (`Pending`) escrow.
//! 5. **Authority.** `fund` and `open_dispute` need the stored buyer's signature
//!    (`has_one = buyer` + `Signer`; the resolver may also `open_dispute`); `refund` and `reject_dispute` need
//!    `config.resolver`'s. `release`, `expire`, `close` and `refund_after_timeout` are
//!    permissionless by design: they can only follow the stored terms.
//! 6. **Account authenticity.** `Account<Escrow>` checks the owner (this program) and the
//!    8-byte discriminator, so look-alike accounts are rejected. `init` with canonical-bump
//!    seeds makes re-initialization impossible and binds the address to `order_id`.
//! 7. **Checked math.** Fee math is `u128` multiply then divide, floor rounding, dust to ops
//!    (`fee.rs`); every lamport add/sub is checked; `overflow-checks = true` in release.
//!
//! # Trust boundary
//!
//! `initialize` stores whatever terms the buyer signs: seller, resolver, buckets, fees, split
//! and times. The program does not know the marketplace's real fee or resolver. The API must
//! treat an escrow as payment for an order only after comparing every stored field with the
//! terms it issued (`escrowMismatch` in `apps/api/src/escrow.ts`). See
//! `docs/security/escrow-review.md`.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

mod fee;
mod state;

// The Mollusk instruction tests live in tests/escrow.rs and use the crate by name. The crate is
// cdylib-only (fat LTO, see Cargo.toml), which has no rlib for an integration test to link, so
// the same file runs inside the lib's unit-test harness instead.
#[cfg(all(test, not(target_os = "solana")))]
mod escrow_tests {
    use crate as trench_escrow;
    include!("../tests/escrow.rs");
}

use fee::{quote, split_fee, FeeError};
use state::Status;

declare_id!("Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw");

// Lets wallets, explorers and security tools (Phantom, Blowfish, Solscan) identify the
// program and its owner. https://github.com/neodyme-labs/solana-security-txt
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "TrenchMart Escrow",
    project_url: "https://trenchmart.fun",
    contacts: "link:https://github.com/Milerius/trenchmart/security/advisories/new",
    policy: "https://github.com/Milerius/trenchmart/security/policy",
    preferred_languages: "en",
    source_code: "https://github.com/Milerius/trenchmart",
    auditors: "None"
}

#[program]
pub mod trench_escrow {
    use super::*;

    /// Creates the program config. Only the program's upgrade authority can call it, once.
    pub fn init_config(
        ctx: Context<InitConfig>,
        resolver: Pubkey,
        dispute_timeout: i64,
    ) -> Result<()> {
        require!(valid_timeout(dispute_timeout), EscrowError::BadTimeout);
        require!(resolver != Pubkey::default(), EscrowError::BadTerms);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.authority.key();
        config.resolver = resolver;
        config.dispute_timeout = dispute_timeout;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Rotates the resolver, the dispute timeout and/or the admin. Signed by `config.admin`.
    pub fn set_config(
        ctx: Context<SetConfig>,
        admin: Pubkey,
        resolver: Pubkey,
        dispute_timeout: i64,
    ) -> Result<()> {
        require!(valid_timeout(dispute_timeout), EscrowError::BadTimeout);
        require!(
            resolver != Pubkey::default() && admin != Pubkey::default(),
            EscrowError::BadTerms
        );
        let config = &mut ctx.accounts.config;
        config.admin = admin;
        config.resolver = resolver;
        config.dispute_timeout = dispute_timeout;
        Ok(())
    }

    /// Creates the order's escrow PDA and records its terms. Pays only rent; moves no price.
    ///
    /// Checks: `fee_bps`, `rebate_bps` <= 10_000; the four split parts sum to exactly 10_000
    /// (summed in `u32`, so wrapping values cannot fake it); the total `price + fee - rebate`
    /// fits in `u64`; `price > 0`; `now <= expires_at <= escrow_until`; no recipient is the
    /// escrow itself or the default key (L-04). The PDA seeds bind the account to the buyer
    /// and `order_id` (L-02), and `init` fails if the account already exists, so terms can
    /// never be rewritten.
    pub fn initialize(
        ctx: Context<Initialize>,
        order_id: [u8; 16],
        args: InitializeArgs,
    ) -> Result<()> {
        require!(
            args.fee_bps <= 10_000 && args.rebate_bps <= 10_000,
            EscrowError::BadBps
        );
        let bps = [
            args.split_buyback_bps,
            args.split_ai_bps,
            args.split_ops_bps,
            args.split_safety_bps,
        ];
        let sum = u32::from(bps[0]) + u32::from(bps[1]) + u32::from(bps[2]) + u32::from(bps[3]);
        require!(sum == 10_000, EscrowError::BadSplit);
        let _ = quote(args.price, args.fee_bps, args.rebate_bps).map_err(map_fee)?;
        require!(args.price > 0, EscrowError::BadAmount);
        let now = Clock::get()?.unix_timestamp;
        require!(
            now <= args.expires_at && args.expires_at <= args.escrow_until,
            EscrowError::BadTerms
        );
        let me = ctx.accounts.escrow.key();
        for key in [
            args.seller,
            args.buyback,
            args.ai_verification,
            args.ops,
            args.safety,
        ] {
            require!(key != me && key != Pubkey::default(), EscrowError::BadTerms);
        }

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = args.seller;
        escrow.resolver = args.resolver;
        escrow.buyback = args.buyback;
        escrow.ai_verification = args.ai_verification;
        escrow.ops = args.ops;
        escrow.safety = args.safety;
        escrow.status = EscrowStatus::Pending;
        escrow.disputed_from = EscrowStatus::Pending;
        escrow.price = args.price;
        escrow.deposit = 0;
        escrow.fee_bps = args.fee_bps;
        escrow.rebate_bps = args.rebate_bps;
        escrow.split_buyback_bps = args.split_buyback_bps;
        escrow.split_ai_bps = args.split_ai_bps;
        escrow.split_ops_bps = args.split_ops_bps;
        escrow.split_safety_bps = args.split_safety_bps;
        escrow.expires_at = args.expires_at;
        escrow.escrow_until = args.escrow_until;
        escrow.bump = ctx.bumps.escrow;
        escrow.order_id = order_id;
        Ok(())
    }

    /// Moves exactly `total = price + fee - rebate` from the buyer into the escrow.
    ///
    /// Checks: status `Pending` (so it runs once), signer is the stored buyer, `now <=
    /// expires_at`, total > 0. The amount is recomputed from stored terms, never passed in.
    pub fn fund(ctx: Context<Fund>) -> Result<()> {
        transition(ctx.accounts.escrow.status, EscrowStatus::Paid)?;
        let now = Clock::get()?.unix_timestamp;
        require!(now <= ctx.accounts.escrow.expires_at, EscrowError::Expired);
        let quoted = quote(
            ctx.accounts.escrow.price,
            ctx.accounts.escrow.fee_bps,
            ctx.accounts.escrow.rebate_bps,
        )
        .map_err(map_fee)?;
        require!(quoted.total > 0, EscrowError::BadAmount);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            quoted.total,
        )?;
        let escrow = &mut ctx.accounts.escrow;
        escrow.deposit = quoted.total;
        escrow.status = EscrowStatus::Paid;
        Ok(())
    }

    /// Pays the seller `price` and each bucket its share of `net_fee`. Permissionless.
    ///
    /// Checks: status is exactly `Paid` (not `Disputed`), `now >= escrow_until`, and
    /// `deposit == total` (a defensive re-check of the amount `fund` stored). Every recipient
    /// account is pinned to the stored pubkey by an `address` constraint, so a cranker
    /// chooses nothing. The lamports `released` add up to `deposit`; the rent stays.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        // Release is permissionless after the window, so it must only ever move funds out of
        // Paid. A Disputed escrow leaves only through the resolver (refund or reject_dispute);
        // the generic Disputed -> Released edge exists for reject_dispute on a released order.
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Paid,
            EscrowError::IllegalTransition
        );
        transition(ctx.accounts.escrow.status, EscrowStatus::Released)?;
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.escrow.escrow_until,
            EscrowError::TooEarly
        );
        let quoted = quote(
            ctx.accounts.escrow.price,
            ctx.accounts.escrow.fee_bps,
            ctx.accounts.escrow.rebate_bps,
        )
        .map_err(map_fee)?;
        let split = split_fee(
            quoted.net_fee,
            [
                ctx.accounts.escrow.split_buyback_bps,
                ctx.accounts.escrow.split_ai_bps,
                ctx.accounts.escrow.split_ops_bps,
                ctx.accounts.escrow.split_safety_bps,
            ],
        )
        .map_err(map_fee)?;
        require!(
            ctx.accounts.escrow.deposit == quoted.total,
            EscrowError::BadAmount
        );
        let escrow_info = ctx.accounts.escrow.to_account_info();
        move_lamports(
            &escrow_info,
            &ctx.accounts.seller.to_account_info(),
            quoted.price,
        )?;
        move_lamports(
            &escrow_info,
            &ctx.accounts.buyback.to_account_info(),
            split.buyback,
        )?;
        move_lamports(
            &escrow_info,
            &ctx.accounts.ai_verification.to_account_info(),
            split.ai_verification,
        )?;
        move_lamports(&escrow_info, &ctx.accounts.ops.to_account_info(), split.ops)?;
        move_lamports(
            &escrow_info,
            &ctx.accounts.safety.to_account_info(),
            split.safety,
        )?;
        ctx.accounts.escrow.status = EscrowStatus::Released;
        Ok(())
    }

    /// Marks an unfunded escrow as expired after `expires_at`. Permissionless; moves nothing.
    ///
    /// Only `Pending -> Expired` exists, so a funded escrow can never be expired out from
    /// under the buyer or the seller.
    pub fn expire(ctx: Context<Expire>) -> Result<()> {
        transition(ctx.accounts.escrow.status, EscrowStatus::Expired)?;
        let now = Clock::get()?.unix_timestamp;
        require!(now > ctx.accounts.escrow.expires_at, EscrowError::TooEarly);
        ctx.accounts.escrow.status = EscrowStatus::Expired;
        Ok(())
    }

    /// Buyer (or the config resolver) freezes the escrow. Moves nothing.
    ///
    /// From `Paid`: only while `now < escrow_until` (the error is `TooEarly`, which here means
    /// "too late"; finding I-04). From `Released`: allowed at any time, as a record only; the
    /// funds are gone and `refund` refuses (`FundsAlreadyReleased`). `disputed_from` remembers
    /// the origin so `reject_dispute` returns to it.
    ///
    /// v2: the config resolver may also open it from `Paid` inside the window, so an off-chain dispute no longer
    /// depends on the buyer signing in time (finding M-01). v2 reports a closed window as
    /// `WindowClosed` (I-04).
    pub fn open_dispute(ctx: Context<OpenDispute>) -> Result<()> {
        let from = ctx.accounts.escrow.status;
        transition(from, EscrowStatus::Disputed)?;
        let who = ctx.accounts.signer.key();
        let by_buyer = who == ctx.accounts.escrow.buyer;
        let by_resolver = who == ctx.accounts.config.resolver;
        require!(by_buyer || by_resolver, EscrowError::Unauthorized);
        if from == EscrowStatus::Paid {
            let now = Clock::get()?.unix_timestamp;
            require!(
                now < ctx.accounts.escrow.escrow_until,
                EscrowError::WindowClosed
            );
        } else {
            // A post-release dispute is the buyer's record only.
            require!(by_buyer, EscrowError::IllegalTransition);
        }
        ctx.accounts.escrow.disputed_from = from;
        ctx.accounts.escrow.status = EscrowStatus::Disputed;
        Ok(())
    }

    /// Default outcome when the resolver never acts (M-02): once a dispute opened from `Paid`
    /// is still open `config.dispute_timeout` seconds after `escrow_until`, anyone may return
    /// the whole deposit to the stored buyer. Same destination and amount as `refund`.
    pub fn refund_after_timeout(ctx: Context<RefundAfterTimeout>) -> Result<()> {
        transition(ctx.accounts.escrow.status, EscrowStatus::Refunded)?;
        require!(
            ctx.accounts.escrow.disputed_from == EscrowStatus::Paid,
            EscrowError::FundsAlreadyReleased
        );
        let now = Clock::get()?.unix_timestamp;
        let deadline = ctx
            .accounts
            .escrow
            .escrow_until
            .checked_add(ctx.accounts.config.dispute_timeout)
            .ok_or(EscrowError::Overflow)?;
        require!(now >= deadline, EscrowError::TimeoutNotReached);
        let deposit = ctx.accounts.escrow.deposit;
        move_lamports(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
            deposit,
        )?;
        ctx.accounts.escrow.deposit = 0;
        ctx.accounts.escrow.status = EscrowStatus::Refunded;
        Ok(())
    }

    /// Closes a terminal escrow and returns its rent to the stored buyer (L-01).
    /// Permissionless. `Refunded` and `Expired` close at once; `Released` only
    /// `RELEASED_CLOSE_GRACE` seconds after `escrow_until`, so the record stays readable while
    /// a post-release dispute can still be handled off chain.
    pub fn close(ctx: Context<Close>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let ok = match escrow.status {
            EscrowStatus::Refunded | EscrowStatus::Expired => true,
            EscrowStatus::Released => {
                let now = Clock::get()?.unix_timestamp;
                let after = escrow
                    .escrow_until
                    .checked_add(RELEASED_CLOSE_GRACE)
                    .ok_or(EscrowError::Overflow)?;
                now >= after
            }
            _ => false,
        };
        require!(ok, EscrowError::NotClosable);
        Ok(())
    }

    /// Resolver returns the whole deposit to the stored buyer.
    ///
    /// Checks: status `Disputed`, disputed from `Paid` (funds still here), signer is the
    /// config resolver, destination is the stored buyer. No time limit for the resolver; if it
    /// never acts, `refund_after_timeout` is the fallback (M-02).
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        transition(ctx.accounts.escrow.status, EscrowStatus::Refunded)?;
        require!(
            ctx.accounts.escrow.disputed_from == EscrowStatus::Paid,
            EscrowError::FundsAlreadyReleased
        );
        let deposit = ctx.accounts.escrow.deposit;
        move_lamports(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
            deposit,
        )?;
        ctx.accounts.escrow.deposit = 0;
        ctx.accounts.escrow.status = EscrowStatus::Refunded;
        Ok(())
    }

    /// Resolver dismisses the dispute: the escrow returns to `Paid` or `Released`. Moves nothing.
    ///
    /// Returning to `Paid` does not skip the window: `release` still waits for `escrow_until`.
    /// The buyer may dispute again while the window is open (finding I-01).
    pub fn reject_dispute(ctx: Context<RejectDispute>) -> Result<()> {
        let back = ctx.accounts.escrow.disputed_from;
        require!(
            back == EscrowStatus::Paid || back == EscrowStatus::Released,
            EscrowError::IllegalTransition
        );
        transition(ctx.accounts.escrow.status, back)?;
        ctx.accounts.escrow.status = back;
        ctx.accounts.escrow.disputed_from = EscrowStatus::Pending;
        Ok(())
    }
}

/// Seconds after `escrow_until` before a `Released` escrow may be closed.
pub const RELEASED_CLOSE_GRACE: i64 = 7 * 86_400;
/// Bounds for `config.dispute_timeout`: 1 hour to 90 days.
pub const MIN_DISPUTE_TIMEOUT: i64 = 3_600;
pub const MAX_DISPUTE_TIMEOUT: i64 = 90 * 86_400;

fn valid_timeout(secs: i64) -> bool {
    (MIN_DISPUTE_TIMEOUT..=MAX_DISPUTE_TIMEOUT).contains(&secs)
}

/// Rejects any status change that is not an edge of the state machine in `state.rs`.
fn transition(from: EscrowStatus, to: EscrowStatus) -> Result<()> {
    require!(
        state::can_transition(from.into(), to.into()),
        EscrowError::IllegalTransition
    );
    Ok(())
}

/// Moves lamports out of a program-owned account by direct balance edits (no CPI needed, as
/// the program owns `from`). Both sides are checked; zero is a no-op so empty buckets with no
/// account are fine. The runtime still enforces that `to` ends rent-exempt or empty (L-03),
/// and borrowing the same account twice fails closed (L-04).
fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let mut from_lamports = from.try_borrow_mut_lamports()?;
    let mut to_lamports = to.try_borrow_mut_lamports()?;
    **from_lamports = from_lamports
        .checked_sub(amount)
        .ok_or(EscrowError::Overflow)?;
    **to_lamports = to_lamports
        .checked_add(amount)
        .ok_or(EscrowError::Overflow)?;
    Ok(())
}

/// True only for a loader-v3 `UpgradeableLoaderState::ProgramData` whose upgrade authority is
/// `Some(authority)`. Layout (bincode): u32 tag `3`, u64 slot, then `Option<Pubkey>` as a 1-byte
/// tag and, for `Some`, 32 bytes. Read by hand so the program does not link bincode/serde
/// deserialization; anything else (wrong tag, `None`, short data) returns false.
fn is_upgrade_authority(program_data: &AccountInfo, authority: &Pubkey) -> bool {
    let Ok(data) = program_data.try_borrow_data() else {
        return false;
    };
    data.len() >= 45
        && data[..4] == 3u32.to_le_bytes()
        && data[12] == 1
        && data[13..45] == authority.as_ref()[..]
}

fn map_fee(err: FeeError) -> Error {
    match err {
        FeeError::Bps => error!(EscrowError::BadBps),
        FeeError::Split => error!(EscrowError::BadSplit),
        FeeError::Overflow => error!(EscrowError::Overflow),
    }
}

/// Terms of one order, as signed by the buyer. Every field is trusted as given (see the
/// crate docs, "Trust boundary").
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs {
    pub seller: Pubkey,
    pub resolver: Pubkey,
    pub buyback: Pubkey,
    pub ai_verification: Pubkey,
    pub ops: Pubkey,
    pub safety: Pubkey,
    pub price: u64,
    pub fee_bps: u16,
    pub rebate_bps: u16,
    pub split_buyback_bps: u16,
    pub split_ai_bps: u16,
    pub split_ops_bps: u16,
    pub split_safety_bps: u16,
    pub expires_at: i64,
    pub escrow_until: i64,
}

/// Program-wide settings. `resolver` is the only key that can settle disputes.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub resolver: Pubkey,
    /// Seconds after `escrow_until` before `refund_after_timeout` may run.
    pub dispute_timeout: i64,
    pub bump: u8,
}

/// One order's escrow. Field order is the on-chain layout that `packages/chain` decodes;
/// do not reorder.
#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub resolver: Pubkey,
    pub buyback: Pubkey,
    pub ai_verification: Pubkey,
    pub ops: Pubkey,
    pub safety: Pubkey,
    pub status: EscrowStatus,
    /// Status before the current dispute; `Pending` when there is none.
    pub disputed_from: EscrowStatus,
    pub price: u64,
    /// Lamports `fund` moved in. Kept after `release` as a record; zeroed by `refund`.
    pub deposit: u64,
    pub fee_bps: u16,
    pub rebate_bps: u16,
    pub split_buyback_bps: u16,
    pub split_ai_bps: u16,
    pub split_ops_bps: u16,
    pub split_safety_bps: u16,
    pub expires_at: i64,
    pub escrow_until: i64,
    pub bump: u8,
    pub order_id: [u8; 16],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowStatus {
    Pending,
    Paid,
    Released,
    Refunded,
    Disputed,
    Expired,
}

impl From<EscrowStatus> for Status {
    fn from(status: EscrowStatus) -> Self {
        match status {
            EscrowStatus::Pending => Status::Pending,
            EscrowStatus::Paid => Status::Paid,
            EscrowStatus::Released => Status::Released,
            EscrowStatus::Refunded => Status::Refunded,
            EscrowStatus::Disputed => Status::Disputed,
            EscrowStatus::Expired => Status::Expired,
        }
    }
}

/// Signed and paid by the program's current upgrade authority.
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: the loader-v3 ProgramData PDA of this program: address pinned by `seeds`, owner
    /// pinned to the loader, and its stored upgrade authority must be `authority`
    /// (`is_upgrade_authority` reads the bincode layout by hand; any other shape fails closed).
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = anchor_lang::solana_program::bpf_loader_upgradeable::ID,
        owner = anchor_lang::solana_program::bpf_loader_upgradeable::ID,
        constraint = is_upgrade_authority(&program_data, &authority.key())
            @ EscrowError::ConfigAuthority
    )]
    pub program_data: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

/// Signed by `config.admin`.
#[derive(Accounts)]
pub struct SetConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

/// `escrow` must be the canonical PDA for `(buyer, order_id)` and must not exist yet.
#[derive(Accounts)]
#[instruction(order_id: [u8; 16])]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), order_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

/// Signed by the stored buyer, who pays.
#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer)]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

/// No signer. Each recipient must equal the pubkey stored in the escrow.
#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: paid the stored seller pubkey.
    #[account(mut, address = escrow.seller)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: paid the stored buyback bucket.
    #[account(mut, address = escrow.buyback)]
    pub buyback: UncheckedAccount<'info>,
    /// CHECK: paid the stored AI verification bucket.
    #[account(mut, address = escrow.ai_verification)]
    pub ai_verification: UncheckedAccount<'info>,
    /// CHECK: paid the stored ops bucket.
    #[account(mut, address = escrow.ops)]
    pub ops: UncheckedAccount<'info>,
    /// CHECK: paid the stored safety bucket.
    #[account(mut, address = escrow.safety)]
    pub safety: UncheckedAccount<'info>,
}

/// No signer, no recipients: expiring moves no lamports.
#[derive(Accounts)]
pub struct Expire<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

/// Signed by the stored buyer or by `config.resolver` (M-01).
#[derive(Accounts)]
pub struct OpenDispute<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

/// Signed by `config.resolver`; pays only the stored buyer.
#[derive(Accounts)]
pub struct Refund<'info> {
    pub resolver: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = resolver)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: deposit returns to the stored buyer.
    #[account(mut, address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,
}

/// Signed by `config.resolver`.
#[derive(Accounts)]
pub struct RejectDispute<'info> {
    pub resolver: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = resolver)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

/// No signer; pays only the stored buyer, only after the configured timeout.
#[derive(Accounts)]
pub struct RefundAfterTimeout<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: deposit returns to the stored buyer.
    #[account(mut, address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,
}

/// No signer; the rent goes only to the stored buyer.
#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut, close = buyer)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: rent returns to the stored buyer.
    #[account(mut, address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,
}

/// Custom error codes start at 6000 in declaration order. Clients match on the numbers, so
/// only append.
#[error_code]
pub enum EscrowError {
    IllegalTransition,
    BadAmount,
    BadBps,
    BadSplit,
    Expired,
    TooEarly,
    FundsAlreadyReleased,
    Overflow,
    /// v2: a `Paid` escrow can no longer be disputed (`now >= escrow_until`).
    WindowClosed,
    /// v2: `initialize` terms are incoherent (times, recipients) or a config key is empty.
    BadTerms,
    /// v2: `init_config` signer is not the program's upgrade authority.
    ConfigAuthority,
    /// v2: `refund_after_timeout` before `escrow_until + dispute_timeout`.
    TimeoutNotReached,
    /// v2: `close` on an escrow that is not terminal (or a `Released` one inside the grace).
    NotClosable,
    /// v2: `dispute_timeout` outside 1 hour to 90 days.
    BadTimeout,
    /// v2: `open_dispute` signer is neither the stored buyer nor the config resolver.
    Unauthorized,
}
